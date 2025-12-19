# Drive Backend API

RESTful API for the Drive file management application, built with Node.js, Express, TypeScript, and PostgreSQL.

## Features

- Full CRUD operations for files and folders
- File upload with metadata storage
- Recursive folder operations (copy, delete)
- PostgreSQL database for metadata
- Local filesystem storage for file content
- Docker support for easy deployment

## API Endpoints

- `GET /api/files` - List files (optional `?parentId=uuid`)
- `GET /api/files/:id` - Get file by ID
- `POST /api/files/upload` - Upload files (multipart/form-data)
- `POST /api/folders` - Create folder
- `PATCH /api/files/:id/rename` - Rename file/folder
- `PATCH /api/files/:id/move` - Move file/folder
- `POST /api/files/:id/copy` - Copy file/folder
- `DELETE /api/files/:id` - Delete file/folder (recursive)
- `GET /api/files/:id/download` - Download file

## Development

### Prerequisites

- Docker Desktop (for Mac) or Docker (for Linux)
- Node.js 20+ (optional, for local development)

### Running with Docker

1. From project root, start services:
   ```bash
   docker-compose up -d
   ```

2. Check logs:
   ```bash
   docker-compose logs -f backend
   ```

3. Stop services:
   ```bash
   docker-compose down
   ```

### Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables (copy `.env.example` to `.env`)

3. Ensure PostgreSQL is running (or use Docker for just the database)

4. Initialize database:
   ```bash
   npm run migrate
   ```

5. Start development server:
   ```bash
   npm run dev
   ```

## Environment Variables

See `.env.example` for all available environment variables.

## Project Structure

```
backend/
├── src/
│   ├── config/       # Database configuration
│   ├── controllers/  # Business logic
│   ├── middleware/   # Express middleware
│   ├── models/       # TypeScript types and models
│   ├── routes/       # API route definitions
│   ├── utils/        # Helper functions
│   └── index.ts      # Application entry point
├── storage/          # File storage (gitignored)
│   ├── uploads/      # Uploaded files
│   └── thumbnails/   # Generated thumbnails
└── dist/             # Compiled JavaScript (gitignored)
```

