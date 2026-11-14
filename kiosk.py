import time
import pyotp
import qrcode
import io
import base64
from flask import Flask, render_template_string

app = Flask(__name__)

TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
DOOR = "SERVER_ROOM_A"
totp = pyotp.TOTP(TOTP_SECRET, interval=15)

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>AccessIQ Edge Kiosk</title>
    <meta http-equiv="refresh" content="3">
    <style>
        body { background-color: #0b0f19; color: #38bdf8; font-family: -apple-system, sans-serif; text-align: center; padding-top: 50px; margin: 0; }
        .badge { display: inline-block; background: rgba(56, 189, 248, 0.15); padding: 5px 15px; border-radius: 20px; font-size: 12px; font-weight: bold; letter-spacing: 1px; margin-bottom: 15px; }
        h1 { font-size: 28px; margin-bottom: 5px; color: #ffffff; }
        p { color: #9ca3af; font-size: 14px; margin-bottom: 25px; }
        .qr-container { background: white; padding: 20px; display: inline-block; border-radius: 16px; box-shadow: 0 0 30px rgba(56, 189, 248, 0.2); }
        img { width: 320px; height: 320px; }
        .timer { color: #10b981; font-size: 22px; font-weight: 800; margin-top: 25px; }
        .warning { color: #ef4444; font-size: 12px; margin-top: 15px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="badge">SECURE AIR-GAPPED NODE</div>
    <h1>AccessIQ Edge Terminal</h1>
    <p>Target: {{ door }} | Scan exclusively with the PingME Super App</p>
    
    <div class="qr-container">
        <img src="data:image/png;base64,{{ qr_code }}" alt="Dynamic QR Code">
    </div>
    
    <div class="timer">Token Refreshes in: {{ remaining }}s</div>
    <div class="warning">Standard iOS/Android cameras will reject this payload.</div>
</body>
</html>
"""

@app.route('/')
def index():
    current_time = int(time.time())
    current_token = totp.now()
    remaining_seconds = 15 - (current_time % 15)
    
    target_payload = f"pingme-auth|{DOOR}|{current_token}"
    
    qr = qrcode.QRCode(box_size=10, border=2)
    qr.add_data(target_payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    qr_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
    
    return render_template_string(HTML_TEMPLATE, qr_code=qr_base64, remaining=remaining_seconds, door=DOOR)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
