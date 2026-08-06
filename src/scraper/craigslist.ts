import { Page } from "playwright";
import { Post } from "./types.js";
import { extractListingUrlsFromHtml, extractPostId } from "./parse.js";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";

const SEARCH_URL =
  "https://washingtondc.craigslist.org/search/rnr?query=Great%20Instrumental%20Music#search=2~list~0";

export async function getListingUrls(page: Page): Promise<string[]> {
  await page.goto(SEARCH_URL, { waitUntil: "networkidle" });

  // Wait for either rendered results or the empty-state message
  await Promise.race([
    page.waitForSelector("li.cl-static-search-result, a.posting-title, .cl-search-result", {
      timeout: 8000,
    }),
    page.waitForSelector("text=no results found", { timeout: 8000 }),
  ]).catch(() => null);

  // Give the SPA a moment to finish hydrating result cards
  await page.waitForTimeout(1500);

  // page.content() reflects the live DOM after JS render
  return extractListingUrlsFromHtml(await page.content(), page.url());
}

export async function scrapeListing(page: Page, url: string): Promise<Post | null> {
  try {
    await page.goto(url, { waitUntil: "networkidle" });

    const post_id = extractPostId(url);
    if (!post_id) return null;

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
