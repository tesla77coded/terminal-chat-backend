/// <reference path="../types/express/index.d.ts" />
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma'
import jwt from 'jsonwebtoken';

// @desc      Register a new user
// @route     /api/user/register 
// @access    Public
export const registerUser = async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'Please provide all the details.' });
    }

    // check if user already exsits
    const userExists = await prisma.user.findUnique({
      where: { email },
    });

    if (userExists) {
      return res.status(400).json({ message: 'User with this email already exists.' });
    }
    const usernameExists = await prisma.user.findUnique({
      where: { username },
    });

    if (usernameExists) {
      return res.status(409).json({ message: 'Username is already taken' });
    }
    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // create new user
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
      },
    });

    // responding with the new user
    if (user) {
      res.status(201).json({
        id: user.id,
        username: user.username,
        email: user.email,
      });
    } else {
      res.status(400).json({ message: 'Invalid user data.' });
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error.' });
  };
};


// @desc    Authenticate a user
// @route   POST /api/users/login
// @access  Public
export const loginUser = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    // 1. Find the user by email
    const user = await prisma.user.findUnique({
      where: { username },
    });

    // 2. Check if user exists and compare passwords
    if (user && (await bcrypt.compare(password, user.password))) {
      // 3. User is valid, generate a JWT
      const token = jwt.sign(
        { id: user.id, role: user.role }, // Payload
        process.env.JWT_SECRET as string,       // Secret
        { expiresIn: '30d' }                    // Options
      );

      // 4. Respond with user data and token
      res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        token: token,
      });
    } else {
      // 5. If user not found or password incorrect
      res.status(401).json({ message: 'Invalid username or password' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};



// @desc      Search for a user by their exact username
// @route     GET /api/users/search?username=xyz
// @access    Private
export const searchUserByUsername = async (req: Request, res: Response) => {
  const usernameToSearch = req.query.username as string;

  //Check if username is provided
  if (!usernameToSearch) {
    return res.status(400).json({ message: 'Username query is required.' });
  }

  try {
    const foundUser = await prisma.user.findUnique({
      where: { username: usernameToSearch },
      select: { id: true, username: true },
    });

    if (!foundUser || foundUser.id === req.user!.id) return res.json([]);

    res.json([foundUser]);

  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'Server error.' });
  };
};



// @desc    Upload or update a user's public key
// @route   POST  /api/users/publicKey
// @access  Private
export const uploadPublicKey = async (req: Request, res: Response) => {
  try {
    const { publicKey } = req.body;
    const userId = req.user!.id;

    if (!publicKey) {
      return res.status(400).json({ message: 'Public key is required.' });
    }

    // Receive the full PEM key and trim any transport whitespace
    await prisma.user.update({
      where: { id: userId },
      data: { publicKey: publicKey },
    });

    res.status(200).json({ message: 'Public key updated successfully.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error.' });
  }
};


// @desc      Get public key of a specified user
// @route     GET /api/users/:userId/publicKey
// @access    Private
export const getPublicKey = async (req: Request, res: Response) => {
  try {
    const userToFindId = req.params.userId;

    const user = await prisma.user.findUnique({
      where: { id: userToFindId },
      select: { publicKey: true },
    });

    if (!user || !user.publicKey) {
      return res.status(404).json({ message: 'Public key not found for this user.' });
    }

    res.json({ publicKey: user.publicKey });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error.' });
  };
};


//@ desc        Get current user's data from a valid token
//@route        GET /api/users/me
//@access       Private
export const getMe = async (req: Request, res: Response) => {
  res.status(200).json(req.user);
};
