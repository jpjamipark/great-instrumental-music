import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractListingUrlsFromHtml,
  extractPostId,
  isListingUrl,
  isWashingtonDcListing,
  normalizeListingUrl,
} from "./parse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), "utf-8");
}

describe("extractPostId", () => {
  it("extracts numeric ids from legacy .html listing urls", () => {
    assert.equal(
      extractPostId(
        "https://washingtondc.craigslist.org/nva/rnr/d/kelner/7942946959.html"
      ),
      "7942946959"
    );
  });

  it("extracts opaque ids from new /view/ listing urls", () => {
    assert.equal(
      extractPostId(
        "https://www.craigslist.org/view/d/fraud-on-the-court/eTXPTWc7nAjPUzdM87zJK4"
      ),
      "eTXPTWc7nAjPUzdM87zJK4"
    );
  });

  it("returns null for non-listing urls", () => {
    assert.equal(
      extractPostId(
        "https://washingtondc.craigslist.org/search/rnr?query=Great%20Instrumental%20Music"
      ),
      null
    );
    assert.equal(extractPostId("https://www.craigslist.org/"), null);
  });
});

describe("isWashingtonDcListing", () => {
  it("accepts washingtondc legacy hosts and rejects other cities", () => {
    assert.equal(
      isWashingtonDcListing(
        "https://washingtondc.craigslist.org/nva/rnr/d/kelner/7942946959.html"
      ),
      true
    );
    assert.equal(
      isWashingtonDcListing(
        "https://baltimore.craigslist.org/rnr/d/other/1111111111.html"
      ),
      false
    );
  });

  it("accepts new www /view/ urls from the area search", () => {
    assert.equal(
      isWashingtonDcListing(
        "https://www.craigslist.org/view/d/fraud-on-the-court/eTXPTWc7nAjPUzdM87zJK4"
      ),
      true
    );
  });
});

describe("normalizeListingUrl", () => {
  it("keeps valid new listing urls and strips hashes", () => {
    assert.equal(
      normalizeListingUrl(
        "https://www.craigslist.org/view/d/fraud-on-the-court/eTXPTWc7nAjPUzdM87zJK4#foo"
      ),
      "https://www.craigslist.org/view/d/fraud-on-the-court/eTXPTWc7nAjPUzdM87zJK4"
    );
  });

  it("rejects nearby-area legacy listings", () => {
    assert.equal(
      normalizeListingUrl(
        "https://baltimore.craigslist.org/rnr/d/other/1111111111.html"
      ),
      null
    );
  });
});

describe("extractListingUrlsFromHtml", () => {
  it("captures actual posts from the new static search markup", () => {
    const html = loadFixture("search-results-new.html");
    const urls = extractListingUrlsFromHtml(html);

    assert.ok(urls.length >= 5, `expected several listings, got ${urls.length}`);
    assert.ok(
      urls.every((url) => url.includes("craigslist.org/view/d/")),
      "expected new /view/ urls"
    );
    assert.ok(
      urls.every((url) => isListingUrl(url)),
      "every url should parse as a listing"
    );
    assert.ok(
      urls.some((url) => extractPostId(url) === "eTXPTWc7nAjPUzdM87zJK4"),
      "expected known rants & raves post id from fixture"
    );
  });

  it("captures posts from JS-rendered new /view/ posting-title links", () => {
    const html = loadFixture("search-results-js-new.html");
    const urls = extractListingUrlsFromHtml(html);

    assert.deepEqual(urls, [
      "https://www.craigslist.org/view/d/fraud-on-the-court/eTXPTWc7nAjPUzdM87zJK4",
      "https://www.craigslist.org/view/d/trump-destroys-us-economy/8zENSmBoZkWEZNjsgtZ2E2",
    ]);
  });

  it("still captures legacy washingtondc .html posting-title links", () => {
    const html = loadFixture("search-results-legacy.html");
    const urls = extractListingUrlsFromHtml(html);

    assert.deepEqual(urls, [
      "https://washingtondc.craigslist.org/nva/rnr/d/kelner/7942946959.html",
      "https://washingtondc.craigslist.org/doc/rnr/d/coolest/7940784620.html",
    ]);
  });

  it("returns an empty list when the search has no results", () => {
    const html = loadFixture("search-results-empty.html");
    const urls = extractListingUrlsFromHtml(html);
    assert.deepEqual(urls, []);
  });
});
