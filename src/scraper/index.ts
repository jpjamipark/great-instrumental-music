import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Database, Post } from "./types.js";
import {
  getListingUrls,
  scrapeListing,
  downloadPostImages,
} from "./craigslist.js";
import { extractPostId } from "./parse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const DATA_FILE = path.join(ROOT_DIR, "data/posts.json");
const IMAGES_DIR = path.join(ROOT_DIR, "images");

function loadDatabase(): Database {
  if (fs.existsSync(DATA_FILE)) {
    const content = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(content);
  }
  return { posts: [] };
}

function saveDatabase(db: Database): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

async function scraper(): Promise<void> {
  console.log("Starting Craigslist scraper...");

  const db = loadDatabase();
  const existingIds = new Set(db.posts.map((p) => p.post_id));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    // Get all listing URLs from search
    console.log("Fetching listing URLs...");
    const urls = await getListingUrls(page);
    console.log(`Found ${urls.length} listings`);

    let newCount = 0;
    let updatedCount = 0;

    for (const url of urls) {
      // Add delay between requests to be polite
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));

      const postId = extractPostId(url);
      if (!postId) continue;

      if (existingIds.has(postId)) {
        // Update last_seen for existing post
        const existingPost = db.posts.find((p) => p.post_id === postId);
        if (existingPost) {
          existingPost.last_seen = new Date().toISOString();
          updatedCount++;
          console.log(`Updated last_seen for: ${existingPost.title || postId}`);
        }
        continue;
      }

      // Scrape new post
      console.log(`Scraping: ${url}`);
      const post = await scrapeListing(page, url);

      if (post) {
        // Download images
        if (post.images.length > 0) {
          console.log(`Downloading ${post.images.length} images...`);
          const localPaths = await downloadPostImages(post, IMAGES_DIR);
          post.images = localPaths;
        }

        db.posts.unshift(post); // Add to beginning (newest first)
        existingIds.add(post.post_id);
        newCount++;
        console.log(`Added: ${post.title}`);
      }
    }

    // Sort by first_seen (newest first)
    db.posts.sort(
      (a, b) =>
        new Date(b.first_seen).getTime() - new Date(a.first_seen).getTime()
    );

    saveDatabase(db);
    console.log(`\nDone! Added ${newCount} new posts, updated ${updatedCount} existing.`);
  } finally {
    await browser.close();
  }
}

scraper().catch(console.error);
