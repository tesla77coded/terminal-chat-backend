// types/express/index.d.ts

// Import the User type from the Prisma client
import { User } from '@prisma/client';

// Extend the Express Request interface
declare global {
  namespace Express {
    export interface Request {
      user?: Omit<User, 'password'>; // Attach user to the request, omitting the password
    }
  }
}
