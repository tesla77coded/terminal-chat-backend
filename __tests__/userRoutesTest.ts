import dotenv from 'dotenv';
dotenv.config(); // Ensure this is at the very top
import request from 'supertest';
import { app, server } from '../server';
import prisma from '../config/prisma';
import bcrypt from 'bcryptjs';

// Use the test database
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe('User Routes API', () => {

  beforeAll(async () => {
    await prisma.$connect();
  });

  // Correctly clean up both tables after all tests are done
  afterAll(async () => {
    await prisma.message.deleteMany({}); // Delete messages first
    await prisma.user.deleteMany({});    // Then delete users
    await prisma.$disconnect();
    server.close();
  });

  // Correctly clean up both tables before each test
  beforeEach(async () => {
    await prisma.message.deleteMany({}); // Delete messages first
    await prisma.user.deleteMany({});    // Then delete users
  });

  describe('POST /api/users/register', () => {

    it('should create a new user and return a 201 status code', async () => {
      const userData = {
        username: 'testuser_success',
        email: `success_${Date.now()}@example.com`,
        password: 'password123',
      };
      const response = await request(app).post('/api/users/register').send(userData);
      expect(response.statusCode).toBe(201);
      expect(response.body.email).toBe(userData.email);
    });

    it('should return a 409 status code for a duplicate username', async () => {
      const userData = { username: 'duplicate_user', email: 'unique@example.com', password: 'password123' };
      await request(app).post('/api/users/register').send(userData).expect(201);
      const secondResponse = await request(app).post('/api/users/register').send({ ...userData, email: 'another_unique@example.com' });
      expect(secondResponse.statusCode).toBe(409);
      expect(secondResponse.body.message).toBe('Username is already taken');
    });

    it('should return a 400 status code for missing fields', async () => {
      const response = await request(app).post('/api/users/register').send({ username: 'testuser_incomplete' });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/users/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/users/register').send({
        username: 'loginuser',
        email: 'login@example.com',
        password: 'password123',
      });
    });
    it('should login a registered user and return a token', async () => {
      const response = await request(app).post('/api/users/login').send({
        username: 'loginuser',
        password: 'password123',
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toHaveProperty('token');
    });
    it('should return 401 for incorrect credentials', async () => {
      const response = await request(app)
        .post('/api/users/login')
        .send({
          username: 'loginuser',
          password: 'wrongPassword',
        });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('Protected Routes', () => {
    let token: string;
    let userOne: any;
    let userTwo: any;

    beforeEach(async () => {
      userOne = await prisma.user.create({
        data: {
          username: 'userone_protected',
          email: 'userone_protected@example.com',
          password: await bcrypt.hash('password123', 10),
        },
      });

      userTwo = await prisma.user.create({
        data: {
          username: 'usertwo_protected',
          email: 'usertwo_protected@example.com',
          password: await bcrypt.hash('password123', 10),
        },
      });

      const loginResponse = await request(app)
        .post('/api/users/login')
        .send({
          username: 'userone_protected',
          password: 'password123',
        });

      token = loginResponse.body.token;
    });

    describe('GET /api/users/search', () => {
      it('should return the searched user if found', async () => {
        const response = await request(app)
          .get(`/api/users/search?username=${userTwo.username}`)
          .set('Authorization', `Bearer ${token}`);

        expect(response.statusCode).toBe(200);
        expect(response.body[0].username).toBe(userTwo.username);
      });
    });

    describe('GET /api/messages/:otherUserId', () => {
      it('should return an array of messages for a valid chat', async () => {
        await prisma.message.create({
          data: {
            senderId: userOne.id,
            receiverId: userTwo.id,
            content: 'Hello, for the test!',
          },
        });

        const response = await request(app)
          .get(`/api/messages/${userTwo.id}`)
          .set('Authorization', `Bearer ${token}`);

        expect(response.statusCode).toBe(200);
        expect(response.body.length).toBeGreaterThan(0);
      });
    });
  });
});
