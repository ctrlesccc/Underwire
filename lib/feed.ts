export type FeedCategory = {
  key: string;
  label: string;
  emoji: string;
  order?: number;
  enabled?: boolean;
};

export type FeedsConfig = {
  categories: FeedCategory[];
  feeds: Record<string, string[]>;
  filters?: {
    maxAgeDays?: number;
    blockedCategories?: string[];
  };
  tzOverrides?: Record<string, string>;
};

export type FeedItem = {
  id: string;
  title: string;
  link: string;
  published?: string;
  image?: string | null;
  source: string;
  description?: string;
  categories?: string[];
};
