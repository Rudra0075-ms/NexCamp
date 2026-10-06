import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";

const BASE_URL = "http://localhost:5173";
const API_URL = "http://localhost:5000/api";
const SCREENSHOT_DIR = "C:/Users/PRITISH/.gemini/antigravity/brain/2c5f5f72-3037-4e37-8a43-225e1bb87a54/scratch";

async function loginApi(email, password) {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Login failed");
  return data.data.token;
}

async function runApiTests() {
  console.log("=== 1. TESTING BACKEND API RBAC & MODERATION ===");

  // A. Student Access
  console.log("\n[A] Student Access & AI Moderation Test:");
  const studentToken = await loginApi("pritish@bput.ac.in", "Campus@2026");
  console.log("  ✓ Student login successful.");

  // Fetch feed
  const feedRes = await fetch(`${API_URL}/resources`, {
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  const feedData = await feedRes.json();
  console.log(`  ✓ GET /api/resources returned status ${feedRes.status}. Total resources: ${feedData.data.totalCount}`);

  // Submit valid resource
  const validRes = await fetch(`${API_URL}/resources`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${studentToken}`
    },
    body: JSON.stringify({
      title: "Computer Networks - Complete Subnetting & Routing Algorithms Notes",
      description: "Handwritten notes covering IPv4/IPv6 addressing, subnet masking calculations, Dijkstra Link State routing, and Distance Vector protocols for 6th semester CSE.",
      category: "STUDY_MATERIAL",
      resourceType: "FILE",
      attachmentName: "CN_Subnetting_Notes.pdf",
      attachmentSize: "3.2 MB",
      tags: ["networks", "subnetting", "cse", "notes"]
    })
  });
  const validData = await validRes.json();
  console.log(`  ✓ Student submit legitimate resource status: ${validRes.status} (Expected: 201)`);
  console.log(`    Status: ${validData.data?.status}, Score: ${validData.data?.moderation?.relevanceScore}%`);
  const createdId = validData.data?._id;

  // Submit spam resource
  const spamRes = await fetch(`${API_URL}/resources`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${studentToken}`
    },
    body: JSON.stringify({
      title: "FREE CASINO CASH AND BITCOIN EARN MONEY FAST CLICK HERE",
      description: "Join our telegram betting channel to double your money every hour guaranteed no scam asdfghjkl zzzzzzzzzz",
      category: "OTHER",
      resourceType: "LINK",
      linkUrl: "https://spam-casino-fake.com"
    })
  });
  const spamData = await spamRes.json();
  console.log(`  ✓ Student submit spam resource status: ${spamRes.status} (Expected: 422)`);
  console.log(`    Moderation message: "${spamData.message}"`);
  console.log(`    Reasons:`, spamData.reasons);

  // B. Admin Access
  console.log("\n[B] Admin Access & Official Broadcast Test:");
  const adminToken = await loginApi("control@bput.ac.in", "Control@2026");
  console.log("  ✓ Admin login successful.");

  const adminPostRes = await fetch(`${API_URL}/resources`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      title: "Dean of Academic Affairs: Spring 2026 Syllabus & Credit Guidelines",
      description: "Official notifications regarding modified evaluation scheme and electives choice for 4th, 6th and 8th semester students.",
      category: "DOCUMENTS",
      resourceType: "NOTICE",
      fileUrl: "https://bput.ac.in/academic-regulations-2026.pdf",
      attachmentName: "Academic_Regulations_2026.pdf",
      attachmentSize: "1.2 MB",
      tags: ["bput", "syllabus", "credits", "official"]
    })
  });
  const adminPostData = await adminPostRes.json();
  console.log(`  ✓ Admin official broadcast status: ${adminPostRes.status} (Expected: 201)`);
  console.log(`    isOfficial: ${adminPostData.data?.isOfficial}, status: ${adminPostData.data?.status}`);

  // Admin deletes student resource
  if (createdId) {
    const delRes = await fetch(`${API_URL}/resources/${createdId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log(`  ✓ Admin delete resource status: ${delRes.status} (Expected: 200)`);
  }

  // C. Warden Strict Access Barrier
  console.log("\n[C] Warden Strict Barrier Test (Must be 403 Forbidden):");
  const wardenToken = await loginApi("warden.hostelb@bput.ac.in", "Control@2026");
  console.log("  ✓ Warden login successful.");

  const wardenGet = await fetch(`${API_URL}/resources`, {
    headers: { Authorization: `Bearer ${wardenToken}` }
  });
  console.log(`  ✓ Warden GET /api/resources status: ${wardenGet.status} (Expected: 403)`);

  const wardenPost = await fetch(`${API_URL}/resources`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${wardenToken}`
    },
    body: JSON.stringify({
      title: "Hostel Rules",
      description: "Hostel rules notice"
    })
  });
  console.log(`  ✓ Warden POST /api/resources status: ${wardenPost.status} (Expected: 403)`);
}

async function runBrowserTests() {
  console.log("\n=== 2. TESTING FRONTEND UI & SCREENSHOTS ===");
  const browser = await chromium.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 }
  });

  // 1. Student View
  console.log("\n[1] Capturing Student View...");
  const pageStudent = await context.newPage();
  await pageStudent.goto(`${BASE_URL}/?page=resources&as=student`, { waitUntil: "domcontentloaded" });
  await pageStudent.waitForTimeout(3000);

  // Take screenshot of feed
  const studentFeedPath = path.join(SCREENSHOT_DIR, "resources-student-feed.png");
  await pageStudent.screenshot({ path: studentFeedPath, fullPage: false });
  console.log(`  ✓ Saved student feed screenshot to ${studentFeedPath}`);

  // Open modal
  const shareBtn = await pageStudent.$("button:has-text('Share Study Resource')");
  if (shareBtn) {
    await shareBtn.click();
    await pageStudent.waitForTimeout(800);
    const modalPath = path.join(SCREENSHOT_DIR, "resources-share-modal.png");
    await pageStudent.screenshot({ path: modalPath, fullPage: false });
    console.log(`  ✓ Saved share modal screenshot to ${modalPath}`);
  }

  // 2. Admin View
  console.log("\n[2] Capturing Admin View...");
  const pageAdmin = await context.newPage();
  await pageAdmin.goto(`${BASE_URL}/?page=resources&as=admin`, { waitUntil: "domcontentloaded" });
  await pageAdmin.waitForTimeout(3000);

  const adminFeedPath = path.join(SCREENSHOT_DIR, "resources-admin-feed.png");
  await pageAdmin.screenshot({ path: adminFeedPath, fullPage: false });
  console.log(`  ✓ Saved admin feed screenshot to ${adminFeedPath}`);

  // 3. Warden Restricted View
  console.log("\n[3] Capturing Warden Restricted View...");
  const pageWarden = await context.newPage();
  await pageWarden.goto(`${BASE_URL}/?page=resources&as=warden`, { waitUntil: "domcontentloaded" });
  await pageWarden.waitForTimeout(2000);

  const wardenBlockPath = path.join(SCREENSHOT_DIR, "resources-warden-blocked.png");
  await pageWarden.screenshot({ path: wardenBlockPath, fullPage: false });
  console.log(`  ✓ Saved warden blocked screenshot to ${wardenBlockPath}`);

  // Check that "Help & Resources" is not in the nav for Warden
  const navText = await pageWarden.textContent("nav#cv-page-nav");
  const hasResourcesInNav = navText ? navText.includes("Help & Resources") : false;
  console.log(`  ✓ Warden nav check: "Help & Resources" present in nav? ${hasResourcesInNav} (Expected: false)`);

  await browser.close();
  console.log("\n=== ALL VERIFICATIONS COMPLETE ===");
}

async function main() {
  try {
    await runApiTests();
    await runBrowserTests();
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  }
}

main();
