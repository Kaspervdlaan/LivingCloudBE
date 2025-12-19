// Database row interface
export interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  name: string;
  google_id: string | null;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
}

// API response interface (without sensitive data)
export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

// Helper function to convert database row to API response
export function rowToUser(row: UserRow): User {
  const user: User = {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };

  if (row.avatar_url) {
    user.avatarUrl = row.avatar_url;
  }

  return user;
}

