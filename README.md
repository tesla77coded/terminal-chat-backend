# Terminal Chat (Backend Server)

This is the backend server for the Terminal Chat application. It is a modern, robust server built with Node.js, TypeScript, and Express, designed to handle real-time, end-to-end encrypted messaging.

**Note:** The main client application for this project can be found here: [github.com/your-username/terminal-chat-client](https://github.com/your-username/terminal-chat-client)

---

## ✨ Features

* **Secure REST API**: Provides endpoints for user registration, login, and public key distribution.
* **Real-Time Communication**: Utilizes a WebSocket server to handle instant message delivery between clients.
* **End-to-End Encryption Support**: Designed to be "zero-trust." The server stores and forwards encrypted message payloads but has no ability to decrypt or read user communications.
* **Persistent Data**: Uses MongoDB with Prisma as an ORM to store user accounts and message history.
* **High Performance**: Leverages Redis (via Upstash) for caching message history to ensure fast load times.
* **Automated Testing**: Includes a full test suite built with Jest and Supertest to ensure API reliability.

---

## 🚀 Getting Started (For Developers)

### Prerequisites

* [Node.js](https://nodejs.org/) (v18 or later)
* A [MongoDB](https://www.mongodb.com/) database (a free Atlas cluster is recommended).
* A [Redis](https://redis.io/) instance (a free Upstash database is recommended).

### Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/tesla77coded/terminal-chat-backend.git](https://github.com/tesla77coded/terminal-chat-backend.git)
    cd terminal-chat-backend
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up environment variables:**
    Create a file named `.env` in the root of the project and add the following variables, replacing the placeholder values with your own credentials:
    ```env
    # MongoDB Connection String
    DATABASE_URL="mongodb+srv://..."

    # Redis Credentials from Upstash
    UPSTASH_REDIS_REST_URL="https://..."
    UPSTASH_REDIS_REST_TOKEN="your-token"

    # JWT Secret Key (use a long, random string)
    JWT_SECRET="your-super-secret-jwt-key"
    ```

4.  **Generate the Prisma Client:**
    ```bash
    npx prisma generate
    ```

5.  **Run the server in development mode:**
    ```bash
    npm run dev
    ```
    The server will be running on `http://localhost:9090` (or the port you've configured).

### Running Tests

To run the automated test suite:
```bash
npm test
```

---

## 💻 Tech Stack

* **Framework**: [Express.js](https://expressjs.com/)
* **Language**: TypeScript
* **Database**: [MongoDB](https://www.mongodb.com/)
* **ORM**: [Prisma](https://www.prisma.io/)
* **Caching**: [Redis](https://redis.io/) (with [Upstash](https://upstash.com/))
* **Real-time**: [WebSockets](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API) (using the `ws` library)
* **Authentication**: JSON Web Tokens (JWT)
* **Testing**: [Jest](https://jestjs.io/) & [Supertest](https://github.com/ladjs/supertest)
