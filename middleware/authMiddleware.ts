import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';

/*
* Middleware to protect routes that require authentication.
* Verifies jwt and attaches the user to the request object.
*/

export const protect = async (req: Request, res: Response, next: NextFunction) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // debugging logs //
      console.log('--- Inside Protect Middleware ---');

      // get the header
      token = req.headers.authorization.split(' ')[1];

      // verify the token
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string };

      // get user from token id and attach to request
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          publicKey: true,
          createdAt: true,
          updatedAt: true,
        }
      });

      if (!user) {
        return res.status(401).json({ message: 'Not authorized, user not found.' });
      }
      req.user = user;
      next();

    } catch (error) {
      // debugging logs //
      console.error('ERROR during token verification:', error);
      // ------------------------------------------------//
      return res.status(401).json({ message: 'Not authorized. Token failed.' });
    };
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token.' });
  }
};


/* Middleware to authorize admin users.
  Used after protect middleware. 
*/

export const admin = (req: Request, res: Response, next: NextFunction) => {
  if (req.user && req.user.role === 'ADMIN') {
    next();
  } else {
    res.status(403).json({ message: 'Stop!! Admin access only.' });
  }
};
