// Database row interface
export interface FileRow {
  id: string;
  name: string;
  type: 'file' | 'folder';
  parent_id: string | null;
  user_id: string;
  size: number | null;
  mime_type: string | null;
  extension: string | null;
  file_path: string | null;
  thumbnail_path: string | null;
  deleted: boolean;
  created_at: Date;
  updated_at: Date;
}

// API response interface (matches frontend File interface)
export interface File {
  id: string;
  name: string;
  type: 'file' | 'folder';
  parentId?: string;
  path?: string;
  size?: number;
  mimeType?: string;
  extension?: string;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl?: string;
  downloadUrl?: string;
}

export interface CreateFolderRequest {
  name: string;
  parentId?: string;
  path?: string;
}

export interface RenameRequest {
  name: string;
}

export interface MoveRequest {
  destinationId?: string;
  destinationPath?: string;
}

export interface CopyRequest {
  destinationId: string;
}

// Helper function to convert database row to API response
export function rowToFile(row: FileRow, baseUrl: string = ''): File {
  const file: File = {
    id: row.id,
    name: row.name,
    type: row.type,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };

  if (row.parent_id) {
    file.parentId = row.parent_id;
  }

  if (row.type === 'file') {
    if (row.size !== null) {
      file.size = row.size;
    }
    if (row.mime_type) {
      file.mimeType = row.mime_type;
    }
    if (row.extension) {
      file.extension = row.extension;
    }
    if (row.file_path) {
      // Generate download URL
      file.downloadUrl = `${baseUrl}/api/files/${row.id}/download`;
      
      // For images, use download URL as thumbnail URL (until we implement thumbnail generation)
      if (row.mime_type && row.mime_type.startsWith('image/')) {
        file.thumbnailUrl = file.downloadUrl;
      } else if (row.thumbnail_path) {
        // If thumbnail exists, use it (for future thumbnail generation)
        file.thumbnailUrl = `${baseUrl}/api/files/${row.id}/thumbnail`;
      }
    }
  }

  return file;
}

