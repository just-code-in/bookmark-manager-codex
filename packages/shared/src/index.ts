export type BookmarkStatus = "live" | "redirected" | "dead";
export type BookmarkSource = "chrome" | "safari" | "unknown";

export type BookmarkRecord = {
  id: string;
  url: string;
  title: string;
  folderPath: string | null;
  dateAdded: string | null;
  status: BookmarkStatus | null;
};

export type ImportSummary = {
  importId: string;
  source: BookmarkSource;
  total: number;
  imported: number;
  duplicates: number;
  live: number;
  redirected: number;
  dead: number;
};
