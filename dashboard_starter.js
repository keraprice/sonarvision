#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// Dashboard directory path
const DASHBOARD_DIR = "/Users/keraprice/source/jira-ba-dashboard-main";

console.log("🐬 Starting JIRA Analytics Dashboard...");

// Check if dashboard directory exists
if (!fs.existsSync(DASHBOARD_DIR)) {
  console.error("❌ Dashboard directory not found:", DASHBOARD_DIR);
  process.exit(1);
}

// Change to dashboard directory
process.chdir(DASHBOARD_DIR);
console.log("📁 Changed to dashboard directory:", DASHBOARD_DIR);

// Check if node_modules exists
if (!fs.existsSync(path.join(DASHBOARD_DIR, "node_modules"))) {
  console.log("📦 Installing dependencies...");

  const install = spawn("npm", ["install"], {
    stdio: "inherit",
    shell: true,
  });

  install.on("close", (code) => {
    if (code === 0) {
      console.log("✅ Dependencies installed successfully");
      startDashboard();
    } else {
      console.error("❌ Failed to install dependencies");
      process.exit(code);
    }
  });
} else {
  console.log("✅ Dependencies already installed");
  startDashboard();
}

function startDashboard() {
  console.log("🚀 Starting JIRA Analytics Dashboard servers...");
  console.log("📊 Frontend will be available at: http://localhost:5173/");
  console.log("🔧 Backend API will be available at: http://localhost:3000/");
  console.log(
    "🔗 SonarVision will automatically detect when the dashboard is running"
  );
  console.log("");
  console.log("Press Ctrl+C to stop both servers");

  // Start backend server first
  console.log("🔧 Starting backend API server...");
  const backend = spawn("npm", ["run", "server"], {
    stdio: "inherit",
    shell: true,
  });

  // Wait a moment for backend to start
  setTimeout(() => {
    console.log("🎨 Starting frontend development server...");
    const frontend = spawn("npm", ["run", "dev"], {
      stdio: "inherit",
      shell: true,
    });

    frontend.on("close", (code) => {
      console.log("Frontend server stopped with code:", code);
      backend.kill();
    });

    frontend.on("error", (error) => {
      console.error("Failed to start frontend:", error);
      backend.kill();
    });
  }, 3000);

  backend.on("close", (code) => {
    console.log("Backend server stopped with code:", code);
  });

  backend.on("error", (error) => {
    console.error("Failed to start backend:", error);
  });
}
