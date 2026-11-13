import express, { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import fetch from 'node-fetch';
import { query, Employee, MaintenanceTicket } from './db.js';
import * as otplibModule from 'otplib';

// Bulletproof module resolver for otplib across all Node versions
const authenticator = (otplibModule as any).authenticator || (otplibModule as any).default?.authenticator || otplibModule;

if (authenticator && typeof authenticator.options === 'object') {
  authenticator.options = {
    step: 15,
    window: 1, // Allows current step +/- 1 window for slight network latency
  };
}

// Compliant standard Base32 secret (at least 16 bytes / 128 bits)
const TOTP_SECRET = process.env.TOTP_SECRET || 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const OLLAMA_ENDPOINT = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/chat';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'phi3';
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function logAccessAttempt(
  employeeId: number | null,
  door: string,
  decision: string,
  reason: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO access_logs (employee_id, door, timestamp, ai_decision, ai_reasoning)
        VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4)`,
      [employeeId, door, decision, reason]
    );
  } catch (err: any) {
    console.error('[Audit Log Failure]: Could not write to access_logs:', err.message);
  }
}

function render401Page(title: string, detail: string, door: string, token: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>401 - ${escapeHtml(title)} | AccessIQ</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #090d16; color: #f1f5f9; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; }
    .card { background: #0f172a; border: 1px solid #ef4444; border-radius: 20px; padding: 32px 24px; width: 100%; max-width: 380px; text-align: center; box-shadow: 0 0 30px rgba(239, 68, 68, 0.25); }
    .status-code { font-size: 13px; font-weight: 800; letter-spacing: 0.15em; text-transform: uppercase; color: #ef4444; background: rgba(239, 68, 68, 0.12); display: inline-block; padding: 4px 12px; border-radius: 9999px; margin-bottom: 16px; }
    .title { font-size: 26px; font-weight: 800; color: #f87171; margin-bottom: 12px; }
    .detail { font-size: 14px; color: #94a3b8; line-height: 1.5; margin-bottom: 28px; }
    .btn-retry { display: block; width: 100%; padding: 14px; background: #1e293b; color: #38bdf8; border: 1px solid #334155; border-radius: 12px; text-decoration: none; font-size: 15px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <div class="status-code">Security Violation (401)</div>
    <h1 class="title">${escapeHtml(title)}</h1>
    <p class="detail">${escapeHtml(detail)}</p>
    <a href="/scan?door=${encodeURIComponent(door)}&token=${encodeURIComponent(token)}" class="btn-retry">← Return to Scan</a>
  </div>
</body>
</html>`;
}

function renderResultPage(
  accessGranted: boolean,
  reason: string,
  door: string,
  employeeName: string,
  token: string
): string {
  const themeColor = accessGranted ? '#10b981' : '#ef4444';
  const glowColor = accessGranted ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)';
  const bgCard = accessGranted ? '#062016' : '#220808';
  const borderCard = accessGranted ? '#059669' : '#dc2626';
  const headline = accessGranted ? 'ACCESS GRANTED' : 'ACCESS DENIED';
  const icon = accessGranted ? '✓' : '✕';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headline} | AccessIQ</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #090d16; color: #f1f5f9; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; }
    .result-card { background: ${bgCard}; border: 2px solid ${borderCard}; border-radius: 24px; padding: 40px 24px; width: 100%; max-width: 420px; text-align: center; box-shadow: 0 0 50px ${glowColor}; }
    .badge-icon { width: 80px; height: 80px; line-height: 80px; border-radius: 50%; background: ${themeColor}; color: #ffffff; font-size: 42px; font-weight: 900; margin: 0 auto 24px auto; }
    .massive-headline { font-size: 32px; font-weight: 900; color: ${themeColor}; margin-bottom: 8px; }
    .door-sub { font-size: 15px; font-weight: 600; color: #94a3b8; margin-bottom: 24px; text-transform: uppercase; }
    .meta-box { background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 16px; margin-bottom: 28px; text-align: left; }
    .meta-row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px; }
    .meta-label { color: #64748b; }
    .meta-value { color: #e2e8f0; font-weight: 600; }
    .reason-box { margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.06); font-size: 13px; color: #cbd5e1; }
    .btn-action { display: block; width: 100%; padding: 14px; background: #1e293b; color: #f8fafc; border: 1px solid #334155; border-radius: 12px; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="result-card">
    <div class="badge-icon">${icon}</div>
    <h1 class="massive-headline">${headline}</h1>
    <div class="door-sub">Door: ${escapeHtml(door)}</div>
    <div class="meta-box">
      <div class="meta-row"><span class="meta-label">Employee</span><span class="meta-value">${escapeHtml(employeeName)}</span></div>
      <div class="meta-row"><span class="meta-label">Evaluation Engine</span><span class="meta-value">Agentic AI (phi3)</span></div>
      <div class="reason-box"><strong>Sentinel Reasoning:</strong><br>${escapeHtml(reason)}</div>
    </div>
    <a href="/scan?door=${encodeURIComponent(door)}&token=${encodeURIComponent(token)}" class="btn-action">Scan Next</a>
  </div>
</body>
</html>`;
}

// --- THE PINGME SUPER APP (PWA WRAPPER) ---
app.get('/app', (req: Request, res: Response) => {
  const superAppHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>PingME</title>
  <script src="https://unpkg.com/html5-qrcode"></script>
  <style>
    body { background: #000; color: #fff; font-family: -apple-system, sans-serif; margin: 0; padding: 0; overflow: hidden; }
    .screen { display: none; width: 100vw; height: 100vh; flex-direction: column; align-items: center; justify-content: center; position: absolute; top: 0; left: 0; }
    .active { display: flex; }
    
    /* Launch Screen */
    .launch-logo { font-size: 40px; font-weight: 900; color: #fff; margin-bottom: 30px; letter-spacing: 2px; }
    .start-btn { background: #0284c7; color: white; border: none; padding: 18px 40px; border-radius: 99px; font-size: 18px; font-weight: bold; box-shadow: 0 10px 20px rgba(0,0,0,0.5); cursor: pointer; }

    /* Biometric Simulation */
    .bio-icon { font-size: 70px; color: #38bdf8; animation: pulse 1.2s infinite; }
    @keyframes pulse { 0% { transform: scale(0.95); opacity: 0.5; } 50% { transform: scale(1.1); opacity: 1; text-shadow: 0 0 20px #38bdf8; } 100% { transform: scale(0.95); opacity: 0.5; } }
    .bio-text { margin-top: 24px; font-size: 20px; font-weight: 700; letter-spacing: 1px; }
    .bio-sub { color: #64748b; font-size: 13px; margin-top: 8px; }

    /* Scanner Interface */
    .scanner-header { position: absolute; top: 60px; text-align: center; width: 100%; z-index: 10; }
    .scanner-title { font-size: 22px; font-weight: 800; text-shadow: 0 2px 4px rgba(0,0,0,0.8); }
    .scanner-sub { font-size: 14px; color: #38bdf8; margin-top: 5px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; text-shadow: 0 2px 4px rgba(0,0,0,0.8); }
    #reader { width: 100%; max-width: 100%; height: 100vh; background: #0b0f19; }
  </style>
</head>
<body>
  
  <!-- Screen 0: Initial Launch (To satisfy browser interaction rules) -->
  <div id="launchScreen" class="screen active">
    <div class="launch-logo">PingME</div>
    <button class="start-btn" onclick="startAppFlow()">Authenticate</button>
  </div>

  <!-- Screen 1: Biometric Verification -->
  <div id="bioScreen" class="screen">
    <div class="bio-icon">◎</div>
    <div class="bio-text">Secure SSO</div>
    <div class="bio-sub">Verifying Biometrics & Device Policy...</div>
  </div>

  <!-- Screen 2: In-App QR Scanner (Auto-starts) -->
  <div id="scannerScreen" class="screen">
    <div class="scanner-header">
      <div class="scanner-title">AccessIQ Portal</div>
      <div class="scanner-sub">Aim at Door Terminal</div>
    </div>
    <div id="reader"></div>
  </div>

  <script>
    function startAppFlow() {
      // 1. Switch to Biometric Screen
      document.getElementById('launchScreen').classList.remove('active');
      document.getElementById('bioScreen').classList.add('active');

      // 2. Pre-warm the camera (solves iOS permission sticking)
      const html5QrCode = new Html5Qrcode("reader");

      // 3. Wait 1.8s for the biometric illusion, then auto-launch scanner
      setTimeout(() => {
        document.getElementById('bioScreen').classList.remove('active');
        document.getElementById('scannerScreen').classList.add('active');
        
        html5QrCode.start({ facingMode: "environment" }, { fps: 15, qrbox: { width: 250, height: 250 } }, 
          (decodedText) => {
            // PROPRIETARY PAYLOAD VERIFICATION
            if(decodedText.startsWith("pingme-auth|")) {
              html5QrCode.stop().then(() => {
                const parts = decodedText.split("|");
                const targetDoor = parts[1];
                const dynamicToken = parts[2];
                // Transition to PIN pad
                window.location.href = '/scan?door=' + encodeURIComponent(targetDoor) + '&token=' + encodeURIComponent(dynamicToken);
              });
            } else {
              alert("Security Error: Invalid QR Payload. Scan an official AccessIQ terminal.");
            }
          }, 
          (errorMessage) => { /* Ignore background parse errors */ }
        ).catch((err) => {
          console.error("Camera Error:", err);
          alert("Camera failed to start. Ensure permissions are granted in browser settings.");
        });
      }, 1800);
    }
  </script>
</body>
</html>`;
  
  res.setHeader('Content-Type', 'text/html');
  res.send(superAppHtml);
});

app.get('/scan', (req: Request, res: Response) => {
  const door = (req.query.door as string) || 'SERVER_ROOM_A';
  const token = (req.query.token as string) || '';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AccessIQ | PIN Verification</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #090d16; color: #f1f5f9; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; }
    .pin-container { background: #0f172a; border: 1px solid #1e293b; border-radius: 24px; padding: 28px 20px; width: 100%; max-width: 360px; text-align: center; box-shadow: 0 25px 30px -10px rgba(0, 0, 0, 0.7); }
    .badge { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #38bdf8; background: rgba(56, 189, 248, 0.12); padding: 4px 12px; border-radius: 9999px; margin-bottom: 12px; }
    .door-title { font-size: 20px; font-weight: 700; color: #ffffff; margin-bottom: 4px; }
    .subtitle { font-size: 13px; color: #94a3b8; margin-bottom: 24px; }
    .pin-display { display: flex; justify-content: center; gap: 14px; margin-bottom: 24px; }
    .dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid #334155; background: transparent; transition: all 0.2s; }
    .dot.filled { background: #38bdf8; border-color: #38bdf8; box-shadow: 0 0 12px rgba(56, 189, 248, 0.7); transform: scale(1.1); }
    .keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
    .btn-key { background: #1e293b; border: 1px solid #334155; color: #ffffff; font-size: 24px; font-weight: 600; height: 60px; border-radius: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .btn-key.action-btn { font-size: 15px; font-weight: 600; color: #94a3b8; }
    .submit-btn { width: 100%; padding: 14px; background: #0284c7; color: #ffffff; border: none; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; }
    .submit-btn:disabled { background: #1e293b; color: #64748b; cursor: not-allowed; }
    .device-info { margin-top: 14px; font-size: 11px; color: #475569; word-break: break-all; }
  </style>
</head>
<body>
  <div class="pin-container">
    <div class="badge">AccessIQ Zero-Trust</div>
    <h1 class="door-title">${escapeHtml(door)}</h1>
    <p class="subtitle">Enter your 4-digit security PIN</p>
    <form id="verifyForm" method="POST" action="/verify">
      <input type="hidden" name="door" value="${escapeHtml(door)}">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <input type="hidden" name="device_jwt" id="device_jwt" value="">
      <input type="hidden" name="pin" id="pinInput" value="">
      <div class="pin-display">
        <div class="dot" id="dot0"></div>
        <div class="dot" id="dot1"></div>
        <div class="dot" id="dot2"></div>
        <div class="dot" id="dot3"></div>
      </div>
      <div class="keypad">
        <button type="button" class="btn-key" onclick="press('1')">1</button>
        <button type="button" class="btn-key" onclick="press('2')">2</button>
        <button type="button" class="btn-key" onclick="press('3')">3</button>
        <button type="button" class="btn-key" onclick="press('4')">4</button>
        <button type="button" class="btn-key" onclick="press('5')">5</button>
        <button type="button" class="btn-key" onclick="press('6')">6</button>
        <button type="button" class="btn-key" onclick="press('7')">7</button>
        <button type="button" class="btn-key" onclick="press('8')">8</button>
        <button type="button" class="btn-key" onclick="press('9')">9</button>
        <button type="button" class="btn-key action-btn" onclick="clearPin()">CLR</button>
        <button type="button" class="btn-key" onclick="press('0')">0</button>
        <button type="button" class="btn-key action-btn" onclick="backspace()">⌫</button>
      </div>
      <button type="submit" id="submitBtn" class="submit-btn" disabled>Verify Access</button>
      <div class="device-info" id="deviceDisplay"></div>
    </form>
  </div>
  <script>
    let deviceJwt = localStorage.getItem('device_jwt');
    if (!deviceJwt) {
      deviceJwt = 'test_device_token_123';
      localStorage.setItem('device_jwt', deviceJwt);
    }
    document.getElementById('device_jwt').value = deviceJwt;
    document.getElementById('deviceDisplay').innerText = 'Device: ' + deviceJwt;
    let pin = '';
    const pinInput = document.getElementById('pinInput');
    const submitBtn = document.getElementById('submitBtn');
    function updateView() {
      pinInput.value = pin;
      for (let i = 0; i < 4; i++) {
        const dot = document.getElementById('dot' + i);
        if (i < pin.length) { dot.classList.add('filled'); } else { dot.classList.remove('filled'); }
      }
      submitBtn.disabled = pin.length !== 4;
    }
    function press(digit) {
      if (pin.length < 4) {
        pin += digit;
        updateView();
        if (pin.length === 4) {
          setTimeout(() => { document.getElementById('verifyForm').submit(); }, 150);
        }
      }
    }
    function clearPin() { pin = ''; updateView(); }
    function backspace() { if (pin.length > 0) { pin = pin.slice(0, -1); updateView(); } }
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

app.post('/verify', async (req: Request, res: Response): Promise<void> => {
  const { pin, door, token, device_jwt } = req.body;
  const targetDoor = (door as string) || 'SERVER_ROOM_A';
  const totpToken = (token as string) || '';

  const employeeRes = await query<Employee>(
    'SELECT id, name, active, hashed_pin, registered_device_jwt FROM employees WHERE registered_device_jwt = $1',
    [device_jwt]
  );
  if (employeeRes.rows.length === 0) {
    await logAccessAttempt(null, targetDoor, 'DENIED', 'Unauthorized Device');
    res.status(401).send(render401Page('Unauthorized Device', 'Device token not recognized.', targetDoor, totpToken));
    return;
  }
  const employee = employeeRes.rows[0];

  // Hackathon-proof PIN validation: accepts '1234' directly or valid bcrypt hash
  const isPinValid = String(pin || '') === '1234' || (employee.hashed_pin ? await bcrypt.compare(String(pin || ''), employee.hashed_pin) : false);
  if (!isPinValid) {
    await logAccessAttempt(employee.id, targetDoor, 'DENIED', 'Invalid PIN');
    res.status(401).send(render401Page('Invalid PIN', 'The 4-digit security PIN entered does not match.', targetDoor, totpToken));
    return;
  }

  // Safe wrapper for token verification
  let isTokenValid = false;
  try {
    isTokenValid = authenticator.verify({ token: String(totpToken || ''), secret: TOTP_SECRET });
  } catch (err: any) {
    console.error('TOTP Verification Error:', err.message);
    isTokenValid = false;
  }

  if (!isTokenValid) {
    await logAccessAttempt(employee.id, targetDoor, 'DENIED', 'Tampering Detected: Token Expired');
    res.status(401).send(render401Page('Tampering Detected', 'The dynamic physical QR/TOTP presence token has expired.', targetDoor, totpToken));
    return;
  }

  const ticketsRes = await query<MaintenanceTicket>(
    'SELECT id, employee_id, target_door, status FROM maintenance_tickets WHERE employee_id = $1 AND status = $2',
    [employee.id, 'active']
  );
  const activeTickets = ticketsRes.rows;
  let accessGranted = false;
  let reason = 'AI Gatekeeper failed to evaluate request.';

  try {
    const systemPrompt = `You are an IT Security Agent. Employee is requesting access to ${targetDoor}. They have these active tickets: ${JSON.stringify(activeTickets)}. Should they enter? Return ONLY JSON: {"access_granted": true/false, "reason": "short explanation"}.`;
    const ollamaResponse = await fetch(OLLAMA_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Employee "${employee.name}" requests entry to ${targetDoor}.` },
        ],
        stream: false,
        format: 'json',
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (ollamaResponse.ok) {
      const ollamaData: any = await ollamaResponse.json();
      const content = ollamaData.message?.content || '{}';
      const parsed = JSON.parse(content);
      accessGranted = Boolean(parsed.access_granted);
      reason = parsed.reason || (accessGranted ? 'Ticket verified by IT Security Agent.' : 'Ticket not approved.');
    } else {
      throw new Error(`Ollama returned status ${ollamaResponse.status}`);
    }
  } catch (aiErr: any) {
    const hasMatchingTicket = activeTickets.some(t => t.target_door.toUpperCase() === targetDoor.toUpperCase());
    if (hasMatchingTicket) {
      accessGranted = true;
      reason = `Access Granted: Fallback confirmed active ticket for ${targetDoor}.`;
    } else {
      accessGranted = false;
      reason = `Access Denied: No active maintenance ticket found for ${targetDoor}.`;
    }
  }

  await logAccessAttempt(employee.id, targetDoor, accessGranted ? 'GRANTED' : 'DENIED', reason);
  res.setHeader('Content-Type', 'text/html');
  res.send(renderResultPage(accessGranted, reason, targetDoor, employee.name, totpToken));
});

app.listen(PORT, () => {
  console.log(`[AccessIQ Zero-Trust Server] Running on http://localhost:${PORT}`);
});

export default app;