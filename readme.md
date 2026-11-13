\# AccessIQ: Zero-Trust Cyber-Physical Edge Security 

\*\*Built for the PingME Enterprise Super App | VentureX Hackathon 2026\*\*



!\[AccessIQ Version](https://img.shields.io/badge/Version-1.0.0-blue.svg)

!\[Architecture](https://img.shields.io/badge/Architecture-Zero\_Trust-success.svg)

!\[AI Model](https://img.shields.io/badge/AI\_Engine-Ollama\_Phi\_3-orange.svg)

!\[Status](https://img.shields.io/badge/Status-Prototype\_Deployed-brightgreen.svg)



\## The Vision: Beyond Credentials to Context

Traditional physical security is broken. RFID badges and basic authenticators only ask \*"Who are you?"\* They fail to ask the most critical operational question: \*"Do you have a valid reason to be in this room right now?"\* 



AccessIQ is a localized, Zero-Trust physical access ecosystem. It bridges HR identity, IT maintenance ticketing, and edge hardware to ensure that a door only opens if the employee possesses the right device, the right PIN, and a \*\*currently active maintenance ticket\*\* evaluated in real-time by an Agentic AI.



\---



\## Proof of Work: System Gallery



\### 1. The Edge Terminal \& Hardware

| Air-Gapped Edge Node | Dynamic QR Kiosk |

| :---: | :---: |

| <img src="WhatsApp%20Image%202026-11-14%20at%201.05.58%20AM%20(1).jpeg" width="400" alt="Raspberry Pi Hardware"> | <img src="WhatsApp%20Image%202026-11-14%20at%202.04.01%20AM.jpeg" width="400" alt="QR Kiosk Display"> |

| \*Headless Raspberry Pi streaming over a local `10.42.x.x` Ethernet subnet.\* | \*15-second rotating encrypted TOTP payloads (`pingme-auth|...`).\* |



\### 2. The PingME Super App (3FA Interception)

| Device Token \& PIN Verification | Automated Intrusion Prevention |

| :---: | :---: |

| <img src="WhatsApp%20Image%202026-11-14%20at%201.05.57%20AM.jpeg" width="300" alt="PIN Pad"> | <img src="WhatsApp%20Image%202026-11-14%20at%201.05.58%20AM.jpeg" width="300" alt="401 Unauthorized"> |

| \*Validating Device JWT possession and Knowledge Factor.\* | \*Instant 401 rejection for cryptographic or PIN mismatches.\* |



\### 3. Engineering Constraints Overcome

<img src="WhatsApp%20Image%202026-11-14%20at%201.05.59%20AM.jpeg" width="600" alt="Terminal Air Gap">

<br>

\*Overcoming DNS resolution and package installation hurdles within a strictly air-gapped, offline deployment environment.\*



\---



\## Architecture \& Three-Factor Authentication (3FA)

We deployed a headless, air-gapped Raspberry Pi at the physical door. To enter, the employee uses the \*\*PingME Super App\*\* PWA, which enforces a strict 3FA pipeline before AI evaluation:



1\. \*\*Possession \& Biometrics (Device JWT):\*\* The backend verifies the device's hardware token bound to the employee profile, while the app enforces a biometric SSO check.

2\. \*\*Presence \& Time (Dynamic QR):\*\* The in-app HTML5 scanner decrypts the edge node's proprietary payload, proving physical presence and preventing generic camera-app hijacking.

3\. \*\*Knowledge (PIN):\*\* The user inputs their 4-digit security PIN to unlock the payload.



\## Local-First Agentic AI (The Gatekeeper)

Once the 3FA is validated, the Express.js backend queries PostgreSQL for active maintenance tickets. It feeds this context to a \*\*local-first Ollama instance running Phi-3\*\*. The AI evaluates the ticket against the requested room and makes a strict JSON-based access decision. 



By running locally, we eliminate cloud-dependency and maintain enterprise data privacy. A hardcoded backend fallback guarantees the door still functions securely if AI inference experiences latency.



\## Technical Hurdles \& Engineering Solutions

1\. \*\*Air-Gapped Edge Interconnectivity:\*\* The Raspberry Pi's headless nature crashed traditional GUI frameworks (X11 errors). We pivoted to a lightweight Flask web server (`kiosk.py`) streaming the encrypted QR payload over an offline network bridge.

2\. \*\*Cryptographic Guardrails \& Clock Drift:\*\* PyOTP and Node `otplib` threw fatal errors due to Base32 padding and secret-length minimums. We engineered a strict 16+ byte Base32 secret and a cryptographic grace window to absorb latency and clock desync between the Pi and backend server.

3\. \*\*App-Restricted Scanning:\*\* Generic smartphone cameras scanning standard URLs posed a session-hijacking risk. We migrated the QR generator to a proprietary string payload that can only be decrypted by the internal PingME Super App wrapper.



\## Tech Stack

\* \*\*Cyber-Physical Edge Node:\*\* Raspberry Pi, Python, Flask, PyOTP

\* \*\*Zero-Trust Backend:\*\* Express.js, TypeScript, bcrypt, otplib

\* \*\*Database \& Auditing:\*\* PostgreSQL 18

\* \*\*AI Evaluation Engine:\*\* Ollama (Phi-3) hosted locally

\* \*\*Frontend:\*\* PWA with HTML5 Camera Integration \& Biometric Simulation

