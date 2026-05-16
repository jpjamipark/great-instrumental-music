import { Page } from "playwright";
import { Post } from "./types.js";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";

const SEARCH_URL =
  "https://washingtondc.craigslist.org/search/rnr?query=Great%20Instrumental%20Music#search=2~list~0";

export async function getListingUrls(page: Page): Promise<string[]> {
  await page.goto(SEARCH_URL, { waitUntil: "networkidle" });

  // Wait for results to load
  await page.waitForTimeout(2000);

  // Get all posting links - only from washingtondc.craigslist.org (exclude nearby areas)
  const urls = await page.$$eval("a.posting-title", (links) =>
    links
      .map((a) => (a as HTMLAnchorElement).href)
      .filter((href) =>
        /\/\d+\.html$/.test(href) &&
        href.includes("washingtondc.craigslist.org")
      )
  );

  // Deduplicate URLs
  return [...new Set(urls)];
}

export async function scrapeListing(page: Page, url: string): Promise<Post | null> {
  try {
    await page.goto(url, { waitUntil: "networkidle" });

    // Extract post_id from URL
    const postIdMatch = url.match(/\/(\d+)\.html/);
    if (!postIdMatch) return null;
    const post_id = postIdMatch[1];

    // Wait for content
    await page.waitForSelector(".postingtitletext", { timeout: 5000 }).catch(() => null);

    // Extract title
    const title = await page.$eval(".postingtitletext",
      (el) => (el as HTMLElement).innerText.trim()
    ).catch(() => "");

    const description = await page.$eval("#postingbody", (el) => {
      // Remove the "QR Code Link to This Post" text
      const clone = el.cloneNode(true) as HTMLElement;
      const qrText = clone.querySelector(".print-information");
      if (qrText) qrText.remove();
      return clone.textContent?.trim() || "";
    }).catch(() => "");

    const location = await page.$eval(".postingtitletext small",
      (el) => el.textContent?.trim().replace(/[()]/g, "") || ""
    ).catch(() => "");

    const price = await page.$eval(".postingtitletext .price",
      (el) => el.textContent?.trim() || "$0"
    ).catch(() => "$0");

    const posted_date = await page.$eval("time.date",
      (el) => el.getAttribute("datetime") || ""
    ).catch(() => "");

    // Get all carousel images from imgList variable (contains all images, not just visible ones)
    const imageUrls = await page.evaluate(() => {
      const imgList = (window as any).imgList;
      if (!imgList || !Array.isArray(imgList)) return [];

      // Get the highest resolution URL (replace 600x450 with 1200x900)
      return imgList.map((img: { url?: string }) => {
        if (!img.url) return null;
        // Upgrade to highest resolution available
        return img.url.replace("_600x450.jpg", "_1200x900.jpg");
      }).filter(Boolean) as string[];
    }).catch(() => []);

    const now = new Date().toISOString();

    return {
      post_id,
      url,
      title,
      description,
      location,
      price,
      posted_date,
      first_seen: now,
      last_seen: now,
      images: imageUrls, // Will be updated with local paths after download
    };
  } catch (error) {
    console.error(`Error scraping ${url}:`, error);
    return null;
  }
}

export async function downloadImage(imageUrl: string, destPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const protocol = imageUrl.startsWith("https") ? https : http;
    const file = fs.createWriteStream(destPath);

    protocol
      .get(imageUrl, (response) => {
        if (response.statusCode === 200) {
          response.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve(true);
          });
        } else {
          file.close();
          fs.unlinkSync(destPath);
          resolve(false);
        }
      })
      .on("error", () => {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        resolve(false);
      });
  });
}

export async function downloadPostImages(
  post: Post,
  imagesDir: string
): Promise<string[]> {
  const postImageDir = path.join(imagesDir, post.post_id);

  if (!fs.existsSync(postImageDir)) {
    fs.mkdirSync(postImageDir, { recursive: true });
  }

  const localPaths: string[] = [];

  for (let i = 0; i < post.images.length; i++) {
    const imageUrl = post.images[i];
    const ext = path.extname(new URL(imageUrl).pathname) || ".jpg";
    const filename = `${i + 1}${ext}`;
    const localPath = path.join(postImageDir, filename);
    const relativePath = `images/${post.post_id}/${filename}`;

    const success = await downloadImage(imageUrl, localPath);
    if (success) {
      localPaths.push(relativePath);
    }
  }

  return localPaths;
}
