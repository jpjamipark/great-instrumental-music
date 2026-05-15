export interface Post {
  post_id: string;
  url: string;
  title: string;
  description: string;
  location: string;
  price: string;
  posted_date: string;
  first_seen: string;
  last_seen: string;
  images: string[];
}

export interface Database {
  posts: Post[];
}
