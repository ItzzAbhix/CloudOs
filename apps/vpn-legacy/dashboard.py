from __future__ import annotations

import ipaddress
import hashlib
import io
import json
import os
import hmac
import base64
from pathlib import Path
import subprocess
import tempfile
import time
from functools import wraps
from urllib.parse import urlparse
from urllib.request import urlopen

from flask import Flask, Response, abort, flash, jsonify, redirect, render_template_string, request, send_file, session, url_for

try:
    import qrcode
except ImportError:
    qrcode = None

app = Flask(__name__)
app.secret_key = os.environ.get("WG_DASHBOARD_SECRET", "change-this-secret")

WG_INTERFACE = os.environ.get("WG_INTERFACE", "wg0")
WG_CONFIG_PATH = Path(os.environ.get("WG_CONFIG_PATH", f"/etc/wireguard/{WG_INTERFACE}.conf"))
STATE_PATH = Path(os.environ.get("WG_DASHBOARD_STATE", str(Path(__file__).with_name("wireguard_dashboard_state.json"))))
DEFAULT_DNS = os.environ.get("WG_DEFAULT_DNS", "1.1.1.1, 1.0.0.1")
DEFAULT_ALLOWED_IPS = os.environ.get("WG_DEFAULT_ALLOWED_IPS", "0.0.0.0/0")
DEFAULT_SERVER_ENDPOINT = os.environ.get("WG_SERVER_ENDPOINT", "")
REFRESH_SECONDS = int(os.environ.get("WG_REFRESH_SECONDS", "10"))
USE_SUDO = os.environ.get("WG_USE_SUDO", "0") == "1"
LOGIN_USERNAME = os.environ.get("DASHBOARD_USERNAME", "admin")
LOGIN_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "admin123")
LOGIN_PASSWORD_HASH = os.environ.get("DASHBOARD_PASSWORD_HASH", "")
AGENT_TOKEN = os.environ.get("WG_AGENT_TOKEN", "")

HTML = """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WireGuard Dashboard</title>
  <style>
    :root { --bg:#efe9ff; --shell:#f7f5ff; --nav:#171922; --panel:#ffffff; --soft:#f1effa; --line:#e5def7; --text:#1f2340; --muted:#7c83a2; --purple:#6e45ff; --blue:#46b1ff; --green:#2ecc71; --orange:#ffb648; --pink:#f16acc; --shadow:0 20px 55px rgba(60,32,120,.12); }
    * { box-sizing:border-box; scroll-behavior:smooth; }
    body { margin:0; font-family:"Segoe UI",Tahoma,sans-serif; color:var(--text); background:linear-gradient(135deg,#f7f3ff,#eee9ff 45%,#ddd2ff); }
    a { color:inherit; text-decoration:none; }
    .app-shell { width:min(1480px,calc(100% - 28px)); margin:14px auto; display:grid; grid-template-columns:250px minmax(0,1fr); background:rgba(255,255,255,.58); border:1px solid rgba(149,126,255,.15); border-radius:28px; overflow:hidden; box-shadow:var(--shadow); min-height:calc(100vh - 28px); backdrop-filter:blur(18px); }
    .sidebar { background:linear-gradient(180deg,#181a23,#202436); color:#fff; padding:28px 18px; display:flex; flex-direction:column; gap:18px; }
    .brand { font-size:34px; font-weight:800; letter-spacing:-.03em; } .brand span { color:#6f6bff; } .brand-sub { color:#9ca4bf; font-size:13px; }
    .nav, .summary-mini { display:grid; gap:10px; }
    .nav a, .summary-mini div { padding:14px 16px; border-radius:16px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.06); }
    .nav a.active { background:linear-gradient(135deg,#734bff,#35b8ff); }
    .summary-mini strong { display:block; font-size:22px; margin-top:6px; }
    .sidebar-footer { margin-top:auto; padding:16px; border-radius:18px; background:rgba(255,255,255,.04); color:#cfd6eb; }
    .content { padding:20px; }
    .topbar { display:flex; justify-content:space-between; gap:18px; align-items:center; background:rgba(255,255,255,.75); border:1px solid rgba(149,126,255,.14); border-radius:24px; padding:16px 20px; }
    .title { margin:0; font-size:34px; letter-spacing:-.03em; }
    .muted { color:var(--muted); }
    .top-actions { display:flex; gap:10px; flex-wrap:wrap; }
    .hero-grid, .stats, .board, .peer-grid, .two-col, .mini-grid { display:grid; gap:16px; }
    .hero-grid { grid-template-columns:1.25fr .75fr; margin-top:16px; }
    .board { grid-template-columns:1.25fr .75fr; margin-top:16px; }
    .stats { grid-template-columns:repeat(4,minmax(0,1fr)); margin-top:16px; }
    .mini-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
    .two-col { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .panel, .tile, .peer, .flash { background:var(--panel); border:1px solid var(--line); border-radius:24px; box-shadow:var(--shadow); }
    .panel { padding:22px; } .tile { padding:18px; } .peer { padding:20px; }
    .gradient-card { background:linear-gradient(135deg,#6c3cff,#7d63ff 45%,#3aaeff); color:#fff; border:none; position:relative; overflow:hidden; }
    .gradient-card::after { content:""; position:absolute; inset:auto -60px -60px auto; width:180px; height:180px; border-radius:50%; background:rgba(255,255,255,.12); }
    .stat-value { font-size:34px; font-weight:800; letter-spacing:-.03em; margin-top:6px; }
    .ring { width:220px; height:220px; margin:0 auto 16px; border-radius:50%; background:conic-gradient(var(--purple) 0 {{ stats.online_peers * 100 / (stats.total_peers or 1) }}%, #ece8f7 0); display:grid; place-items:center; }
    .ring-inner { width:150px; height:150px; border-radius:50%; background:#fff; display:grid; place-items:center; text-align:center; }
    .row { display:flex; justify-content:space-between; gap:14px; padding:10px 0; border-bottom:1px solid #f0ebfb; } .row:last-child { border-bottom:0; padding-bottom:0; }
    .mono { font-family:Consolas,"Courier New",monospace; word-break:break-word; }
    .badge { display:inline-flex; align-items:center; gap:8px; border-radius:999px; padding:7px 12px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; }
    .ok { background:#eafaf0; color:#1b9f52; } .bad { background:#fff0ef; color:#d94a41; } .warn { background:#fff8ea; color:#d8961c; }
    .flash { padding:14px 16px; margin-top:14px; }
    .section-title { display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom:14px; }
    .section-title h2, .section-title h3 { margin:0; }
    input, textarea, button, select { width:100%; border-radius:16px; border:1px solid var(--line); background:#fbfaff; color:var(--text); padding:12px 14px; font:inherit; }
    textarea { min-height:220px; resize:vertical; }
    button { cursor:pointer; border:0; background:linear-gradient(135deg,#6f49ff,#39b6ff); color:#fff; font-weight:700; box-shadow:0 14px 32px rgba(103,74,255,.22); }
    button.alt { background:#f1effa; color:var(--text); border:1px solid var(--line); box-shadow:none; }
    .action-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
    .form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
    .peer-grid { grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); }
    .config-grid { display:grid; grid-template-columns:.9fr 1.1fr; gap:16px; }
    .quick-list { display:grid; gap:12px; }
    .quick-item { padding:14px 16px; border-radius:18px; background:#f8f6ff; border:1px solid var(--line); }
    .bar-chart { display:flex; align-items:flex-end; gap:12px; min-height:220px; padding-top:18px; }
    .bar { flex:1; border-radius:18px 18px 12px 12px; background:linear-gradient(180deg,#b49fff,#6f49ff); min-height:24px; position:relative; }
    .bar.alt { background:linear-gradient(180deg,#90d7ff,#39b6ff); }
    .bar span { position:absolute; bottom:-28px; left:50%; transform:translateX(-50%); color:var(--muted); font-size:12px; }
    .chart-shell { background:#f9f7ff; border:1px solid var(--line); border-radius:22px; padding:16px; }
    .chart-shell svg { width:100%; height:220px; display:block; }
    .qr-preview { margin-top:12px; padding:12px; border-radius:18px; background:#f8f6ff; border:1px dashed #d9cff7; display:grid; place-items:center; }
    .qr-preview img { width:180px; height:180px; object-fit:contain; background:#fff; padding:10px; border-radius:18px; }
    .inline { display:flex; gap:10px; }
    .inline button { width:auto; }
    .search { margin-top:8px; }
    .hide { display:none; }
    @media (max-width:1200px){ .app-shell,.hero-grid,.board,.config-grid,.two-col { grid-template-columns:1fr; } .stats,.mini-grid,.form-grid,.action-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    @media (max-width:820px){ .app-shell { grid-template-columns:1fr; } .stats,.mini-grid,.form-grid,.action-grid,.two-col { grid-template-columns:1fr; } .topbar { flex-direction:column; align-items:flex-start; } }
  </style>
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar">
      <div>
        <div class="brand">Wire<span>OS</span></div>
        <div class="brand-sub">Control WireGuard from a single panel</div>
      </div>
      <nav class="nav">
        <a href="#overview" class="active">Overview</a>
        <a href="#provision">Provision Client</a>
        <a href="#peers">Peers</a>
        <a href="#settings">Server Defaults</a>
        <a href="#config">Config Editor</a>
      </nav>
      <div class="summary-mini">
        <div><span class="muted">Interface</span><strong>{{ "Up" if interface.up else "Down" }}</strong></div>
        <div><span class="muted">Online Peers</span><strong>{{ stats.online_peers }}</strong></div>
        <div><span class="muted">Latest Sync</span><strong>{{ stats.latest_handshake }}</strong></div>
      </div>
      <div class="sidebar-footer">
        <div class="muted">Host</div>
        <div>{{ system.hostname }}</div>
        <div class="muted" style="margin-top:8px;">Uptime</div>
        <div>{{ system.uptime }}</div>
      </div>
    </aside>
    <main class="content">
      <section class="topbar" id="overview">
        <div>
          <div class="muted">WireGuard Command Center</div>
          <h1 class="title">{{ interface.name }} dashboard</h1>
          <div class="muted">Config: <span class="mono">{{ config_path }}</span> · Updated {{ generated_at }}</div>
        </div>
        <div class="top-actions">
          <a href="{{ url_for('logout') }}"><button type="button" class="alt">Logout</button></a>
          <form method="post" action="{{ url_for('interface_action', action='start') }}"><button type="submit">Start</button></form>
          <form method="post" action="{{ url_for('interface_action', action='stop') }}"><button type="submit" class="alt">Stop</button></form>
          <form method="post" action="{{ url_for('interface_action', action='restart') }}"><button type="submit">Restart</button></form>
          {% if interface.config_accessible %}
            <form method="post" action="{{ url_for('interface_action', action='reload') }}"><button type="submit" class="alt">Apply Config</button></form>
          {% endif %}
        </div>
      </section>

      {% with messages = get_flashed_messages(with_categories=true) %}
        {% for category, message in messages %}
          <div class="flash">{{ message }}</div>
        {% endfor %}
      {% endwith %}

      <section class="hero-grid">
        <div class="panel gradient-card">
          <div class="muted" style="color:rgba(255,255,255,.8);">Network posture</div>
          <h2 style="margin:8px 0 0;font-size:40px;"><span id="online-peers">{{ stats.online_peers }}</span>/<span id="total-peers">{{ stats.total_peers }}</span> peers active</h2>
          <p style="max-width:520px;color:rgba(255,255,255,.84);">Provision clients, apply runtime changes, edit the server config, and keep common VPN defaults inside the dashboard instead of shell commands.</p>
          <div class="mini-grid">
            <div class="tile" style="background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.14);"><div class="muted" style="color:rgba(255,255,255,.75);">Rx</div><div class="stat-value" id="total-rx">{{ stats.total_rx }}</div></div>
            <div class="tile" style="background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.14);"><div class="muted" style="color:rgba(255,255,255,.75);">Tx</div><div class="stat-value" id="total-tx">{{ stats.total_tx }}</div></div>
            <div class="tile" style="background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.14);"><div class="muted" style="color:rgba(255,255,255,.75);">Pool</div><div style="font-size:20px;font-weight:700;">{{ stats.pool or "Not detected" }}</div></div>
          </div>
        </div>
        <div class="panel">
          <div class="ring"><div class="ring-inner"><div><div class="muted">Protection</div><div class="stat-value">{{ (stats.online_peers * 100 // (stats.total_peers or 1)) if stats.total_peers else 0 }}%</div></div></div></div>
          <div class="row"><span class="muted">Listen Port</span><span>{{ interface.listen_port or "N/A" }}</span></div>
          <div class="row"><span class="muted">Latest Handshake</span><span id="latest-handshake">{{ stats.latest_handshake }}</span></div>
          <div class="row"><span class="muted">Addresses</span><span>{{ interface.addresses or "N/A" }}</span></div>
          <div class="row"><span class="muted">Server Key</span><span class="mono">{{ interface.public_key_short }}</span></div>
        </div>
      </section>

      <section class="stats">
        <div class="tile"><div class="muted">Interface Status</div><div class="stat-value">{{ "Up" if interface.up else "Down" }}</div></div>
        <div class="tile"><div class="muted">Configured Peers</div><div class="stat-value">{{ stats.total_peers }}</div></div>
        <div class="tile"><div class="muted">Endpoint Hint</div><div style="margin-top:8px;font-weight:700;" class="mono">{{ interface.endpoint_hint or "Unset" }}</div></div>
        <div class="tile"><div class="muted">Next Client IP</div><div class="stat-value" style="font-size:24px;">{{ stats.next_ip or "Manual" }}</div></div>
      </section>

      <section class="board">
        <div class="panel">
          <div class="section-title">
            <h2>Usage Analytics</h2>
            <span class="muted">24 hour traffic samples</span>
          </div>
          <div class="chart-shell">
            {% if analytics_chart %}
              <div class="inline" style="margin-bottom:10px;">
                <div class="quick-item" style="flex:1;"><strong>{{ analytics_chart.latest_rx_mb }} MB</strong><div class="muted">Latest Rx sample</div></div>
                <div class="quick-item" style="flex:1;"><strong>{{ analytics_chart.latest_tx_mb }} MB</strong><div class="muted">Latest Tx sample</div></div>
              </div>
              <svg viewBox="0 0 520 220" preserveAspectRatio="none">
                <line x1="20" y1="180" x2="500" y2="180" stroke="#ddd4f8" stroke-width="2"></line>
                <polyline fill="none" stroke="#6f49ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" points="{{ analytics_chart.rx_points }}"></polyline>
                <polyline fill="none" stroke="#39b6ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" points="{{ analytics_chart.tx_points }}"></polyline>
                {% for label in analytics_chart.labels %}
                  <text x="{{ label.x }}" y="205" font-size="10" text-anchor="middle" fill="#7c83a2">{{ label.label }}</text>
                {% endfor %}
              </svg>
            {% else %}
              <div class="muted">Not enough samples yet. Keep the dashboard running and it will build traffic history automatically.</div>
            {% endif %}
          </div>
        </div>
        <div class="panel">
          <div class="section-title"><h2>Quick Actions</h2><span class="muted">Reduce SSH use</span></div>
          <div class="quick-list">
            <div class="quick-item"><strong>Create clients</strong><div class="muted">Generate keys, allocate IPs, write config, and get a ready client profile.</div></div>
            <div class="quick-item"><strong>Manage defaults</strong><div class="muted">Set endpoint, DNS, allowed routes, and auto-refresh from the UI.</div></div>
            <div class="quick-item"><strong>Live config apply</strong><div class="muted">Edit the raw config and apply it to the interface without opening SSH again.</div></div>
          </div>
        </div>
      </section>

      <section class="two-col" id="provision" style="margin-top:16px;">
        <div class="panel">
          <div class="section-title"><h2>Provision Client</h2><span class="muted">Create and ship a new peer</span></div>
          <form method="post" action="{{ url_for('create_peer') }}" class="form-grid">
            <input name="name" placeholder="Client name" required>
            <input name="address" placeholder="Client address, e.g. 10.0.0.2/32">
            <input name="dns" value="{{ defaults.dns }}" placeholder="DNS">
            <input name="allowed_ips" value="{{ defaults.allowed_ips }}" placeholder="Allowed IPs">
            <input name="endpoint" value="{{ interface.endpoint_hint }}" placeholder="Server endpoint host:port">
            <input name="keepalive" value="25" placeholder="PersistentKeepalive">
            <div style="grid-column:1 / -1;"><button type="submit">Create Client</button></div>
          </form>
        </div>
        <div class="panel">
          <div class="section-title"><h2>Latest Generated Client</h2><span class="muted">Copy into WireGuard app</span></div>
          {% if generated_peer %}
            <div class="row"><span class="muted">Name</span><span>{{ generated_peer.name }}</span></div>
            <div class="row"><span class="muted">Address</span><span>{{ generated_peer.address }}</span></div>
            <div class="row"><span class="muted">Public Key</span><span class="mono">{{ generated_peer.public_key }}</span></div>
            <div class="inline" style="margin-bottom:12px;">
              <a href="{{ url_for('download_client', peer_id=generated_peer.peer_id) }}"><button type="button" class="alt">Download .conf</button></a>
              {% if qrcode_available %}
                <a href="{{ url_for('client_qr', peer_id=generated_peer.peer_id) }}" target="_blank"><button type="button">Open QR</button></a>
              {% endif %}
            </div>
            {% if generated_peer.qr_data_uri %}
              <div class="qr-preview">
                <img src="{{ generated_peer.qr_data_uri }}" alt="Client QR code">
              </div>
            {% endif %}
            <textarea readonly class="mono">{{ generated_peer.client_config }}</textarea>
          {% else %}
            <div class="muted">No generated client yet.</div>
          {% endif %}
        </div>
      </section>

      <section class="two-col" id="settings" style="margin-top:16px;">
        <div class="panel">
          <div class="section-title"><h2>Server Defaults</h2><span class="muted">Used for new client profiles</span></div>
          <form method="post" action="{{ url_for('save_settings') }}" class="form-grid">
            <input name="endpoint" value="{{ interface.endpoint_hint }}" placeholder="Public endpoint host:port">
            <input name="dns" value="{{ defaults.dns }}" placeholder="DNS servers">
            <input name="allowed_ips" value="{{ defaults.allowed_ips }}" placeholder="Allowed IPs">
            <input name="refresh_seconds" value="{{ defaults.refresh_seconds }}" placeholder="Refresh seconds">
            <div style="grid-column:1 / -1;"><button type="submit">Save Dashboard Defaults</button></div>
          </form>
        </div>
        <div class="panel">
          <div class="section-title"><h2>Recent Client Profiles</h2><span class="muted">Reopen generated configs</span></div>
          <div class="quick-list">
            {% for item in generated_configs[:4] %}
              <div class="quick-item">
                <div style="display:flex;justify-content:space-between;gap:12px;">
                  <strong>{{ item.name }}</strong>
                  <span class="muted">{{ item.address }}</span>
                </div>
                <div class="mono muted" style="margin:6px 0 10px;">{{ item.public_key }}</div>
                <div class="inline" style="margin:0 0 8px;">
                  <a href="{{ url_for('download_client', peer_id=item.peer_id) }}"><button type="button" class="alt">Download</button></a>
                  {% if qrcode_available %}
                    <a href="{{ url_for('client_qr', peer_id=item.peer_id) }}" target="_blank"><button type="button">QR</button></a>
                  {% endif %}
                </div>
                {% if item.qr_data_uri %}
                  <div class="qr-preview"><img src="{{ item.qr_data_uri }}" alt="Client QR code"></div>
                {% endif %}
                <textarea readonly class="mono" style="min-height:120px;">{{ item.client_config }}</textarea>
              </div>
            {% else %}
              <div class="muted">Generated configs will appear here after you create clients.</div>
            {% endfor %}
          </div>
        </div>
      </section>

      {% if interface.config_accessible %}
        <section class="config-grid" id="config" style="margin-top:16px;">
          <div class="panel">
            <div class="section-title"><h2>Config Editor</h2><span class="muted">Edit raw server config safely</span></div>
            <div class="quick-list">
              <div class="quick-item"><strong>Backups on every save</strong><div class="muted">Each write creates a timestamped backup before replacing the current file.</div></div>
              <div class="quick-item"><strong>Apply without SSH</strong><div class="muted">Save and push the current config into the live interface from this page.</div></div>
              <div class="quick-item"><strong>Save runtime to disk</strong><div class="muted">Use the button below to persist live peer changes back to the config file.</div></div>
            </div>
            <div class="action-grid" style="margin-top:16px;">
              <form method="post" action="{{ url_for('interface_action', action='save') }}"><button type="submit" class="alt">Save Runtime To Config</button></form>
              <form method="post" action="{{ url_for('interface_action', action='reload') }}"><button type="submit">Apply Current Config</button></form>
              <form method="post" action="{{ url_for('interface_action', action='restart') }}"><button type="submit" class="alt">Restart Interface</button></form>
            </div>
            <form method="post" action="{{ url_for('create_backup') }}" style="margin-top:12px;"><button type="submit">Create Backup</button></form>
            <div class="quick-list" style="margin-top:12px;">
              {% for backup in backups %}
                <form method="post" action="{{ url_for('restore_backup') }}" class="quick-item">
                  <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
                    <div><strong>{{ backup.created_at }}</strong><div class="muted mono">{{ backup.path }}</div></div>
                    <input type="hidden" name="path" value="{{ backup.path }}">
                    <button type="submit" class="alt">Restore</button>
                  </div>
                </form>
              {% else %}
                <div class="muted">No backups created yet.</div>
              {% endfor %}
            </div>
          </div>
          <div class="panel">
            <form method="post" action="{{ url_for('save_config') }}">
              <textarea name="config_text" class="mono" spellcheck="false">{{ config_text }}</textarea>
              <div class="inline" style="margin-top:12px;">
                <button type="submit">Save Config File</button>
                <button type="submit" name="apply_now" value="1" class="alt">Save And Apply</button>
              </div>
            </form>
          </div>
        </section>
      {% endif %}

      <section class="panel" id="peers" style="margin-top:16px;">
        <div class="section-title"><h2>Peer Inventory</h2><span class="muted">Rename, inspect, and remove peers</span></div>
        <input id="search" class="search" placeholder="Search peers by name, key, endpoint, or IP">
        <div class="peer-grid" style="margin-top:14px;">
          {% for peer in peers %}
            <article class="peer" data-search="{{ (peer.name ~ ' ' ~ peer.public_key ~ ' ' ~ peer.endpoint ~ ' ' ~ peer.allowed_ips)|lower }}" data-peer-id="{{ peer.peer_id }}">
              <div style="display:flex;justify-content:space-between;gap:12px;align-items:start;">
                <div>
                  <h3 style="margin:0 0 8px;">{{ peer.name }}</h3>
                  <span class="badge {{ 'ok' if peer.online else ('warn' if peer.seen_before else 'bad') }}" data-role="status">{{ "Online" if peer.online else ("Seen Before" if peer.seen_before else "Never Connected") }}</span>
                </div>
                <form method="post" action="{{ url_for('delete_peer', peer_id=peer.peer_id) }}" onsubmit="return confirm('Remove {{ peer.name }}?');"><button type="submit" class="alt">Remove</button></form>
              </div>
              <div class="row"><span class="muted">Public Key</span><span class="mono">{{ peer.public_key_short }}</span></div>
              <div class="row"><span class="muted">Allowed IPs</span><span>{{ peer.allowed_ips }}</span></div>
              <div class="row"><span class="muted">Endpoint</span><span class="mono">{{ peer.endpoint }}</span></div>
              <div class="row"><span class="muted">Handshake</span><span data-role="handshake">{{ peer.handshake_ago }}</span></div>
              <div class="row"><span class="muted">Transfer</span><span data-role="transfer">{{ peer.rx_human }} down / {{ peer.tx_human }} up</span></div>
              <div class="row"><span class="muted">Keepalive</span><span>{{ peer.keepalive }}</span></div>
              <div class="row"><span class="muted">Location</span><span>{{ peer.geo.city or "Unknown" }}{% if peer.geo.country %}, {{ peer.geo.country }}{% endif %}</span></div>
              {% if peer.blocked_until_human %}
                <div class="row"><span class="muted">Blocked Until</span><span>{{ peer.blocked_until_human }}</span></div>
              {% endif %}
              <form method="post" action="{{ url_for('rename_peer', peer_id=peer.peer_id) }}" class="inline" style="margin-top:12px;">
                <input name="name" value="{{ peer.name }}" required>
                <button type="submit">Rename</button>
              </form>
              <form method="post" action="{{ url_for('update_peer', peer_id=peer.peer_id) }}" class="form-grid" style="margin-top:10px;">
                <input name="allowed_ips" value="{{ peer.allowed_ips }}" placeholder="AllowedIPs">
                <input name="keepalive" value="{{ '' if peer.keepalive == 'off' else peer.keepalive }}" placeholder="PersistentKeepalive">
                <div style="grid-column:1 / -1;"><button type="submit" class="alt">Update Peer Routes</button></div>
              </form>
              <div class="inline" style="margin-top:10px;flex-wrap:wrap;">
                {% if peer.disabled %}
                  <form method="post" action="{{ url_for('enable_peer', peer_id=peer.peer_id) }}"><button type="submit">Enable</button></form>
                {% else %}
                  <form method="post" action="{{ url_for('disable_peer', peer_id=peer.peer_id) }}"><button type="submit" class="alt">Disable</button></form>
                  <form method="post" action="{{ url_for('reconnect_peer', peer_id=peer.peer_id) }}"><button type="submit">Force Reconnect</button></form>
                  <form method="post" action="{{ url_for('block_peer', peer_id=peer.peer_id) }}" class="inline">
                    <input name="minutes" value="30" style="width:82px;">
                    <button type="submit" class="alt">Block</button>
                  </form>
                {% endif %}
              </div>
            </article>
          {% else %}
            <div class="tile">No peers found.</div>
          {% endfor %}
        </div>
      </section>
    </main>
  </div>
  <script>
    const search = document.getElementById("search");
    const peers = Array.from(document.querySelectorAll("[data-search]"));
    search?.addEventListener("input", () => {
      const value = search.value.trim().toLowerCase();
      for (const peer of peers) peer.classList.toggle("hide", value && !peer.dataset.search.includes(value));
    });
    async function refreshLiveData() {
      try {
        const response = await fetch("{{ url_for('dashboard_api') }}", { credentials: "same-origin" });
        if (!response.ok) return;
        const data = await response.json();
        const online = document.getElementById("online-peers");
        const total = document.getElementById("total-peers");
        const latest = document.getElementById("latest-handshake");
        const rx = document.getElementById("total-rx");
        const tx = document.getElementById("total-tx");
        if (online) online.textContent = data.stats.online_peers;
        if (total) total.textContent = data.stats.total_peers;
        if (latest) latest.textContent = data.stats.latest_handshake;
        if (rx) rx.textContent = data.stats.total_rx;
        if (tx) tx.textContent = data.stats.total_tx;
        for (const peer of data.peers) {
          const card = document.querySelector(`[data-peer-id="${peer.peer_id}"]`);
          if (!card) continue;
          const status = card.querySelector('[data-role="status"]');
          const handshake = card.querySelector('[data-role="handshake"]');
          const transfer = card.querySelector('[data-role="transfer"]');
          if (status) {
            status.textContent = peer.disabled ? "Disabled" : (peer.online ? "Online" : "Offline");
            status.className = `badge ${peer.disabled ? "warn" : (peer.online ? "ok" : "bad")}`;
          }
          if (handshake) handshake.textContent = peer.handshake_ago;
          if (transfer) transfer.textContent = `${peer.rx_human} down / ${peer.tx_human} up`;
        }
      } catch (error) {
      }
    }
    setInterval(refreshLiveData, {{ refresh_seconds * 1000 }});
  </script>
</body>
</html>
"""

LOGIN_HTML = """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WireOS Login</title>
  <style>
    body { margin:0; min-height:100vh; display:grid; place-items:center; font-family:"Segoe UI",Tahoma,sans-serif; background:linear-gradient(135deg,#f7f3ff,#eee9ff 45%,#ddd2ff); color:#1f2340; }
    .card { width:min(420px,calc(100% - 24px)); background:#fff; border:1px solid #e5def7; border-radius:28px; padding:28px; box-shadow:0 20px 55px rgba(60,32,120,.12); }
    h1 { margin:0 0 8px; } .muted { color:#7c83a2; margin-bottom:18px; } input, button { width:100%; border-radius:16px; border:1px solid #e5def7; padding:12px 14px; font:inherit; box-sizing:border-box; } input { margin-bottom:12px; background:#fbfaff; } button { border:0; cursor:pointer; color:#fff; background:linear-gradient(135deg,#6f49ff,#39b6ff); font-weight:700; } .flash { margin-bottom:12px; padding:12px; border-radius:14px; background:#fff0ef; color:#d94a41; }
  </style>
</head>
<body>
  <form class="card" method="post" action="{{ url_for('login') }}">
    <h1>WireOS</h1>
    <div class="muted">Sign in to manage your VPN panel</div>
    {% with messages = get_flashed_messages(with_categories=true) %}
      {% for category, message in messages %}
        <div class="flash">{{ message }}</div>
      {% endfor %}
    {% endwith %}
    <input name="username" placeholder="Username" required>
    <input name="password" type="password" placeholder="Password" required>
    <button type="submit">Login</button>
  </form>
</body>
</html>
"""


def run_command(args, input_text=None, check=True):
    command = (["sudo", "-n"] + list(args)) if USE_SUDO else list(args)
    result = subprocess.run(command, input=input_text, text=True, capture_output=True, check=False)
    if check and result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"Command failed: {' '.join(command)}")
    return result.stdout.strip()


def interface_is_up():
    return subprocess.run((["sudo", "-n", "wg", "show", WG_INTERFACE] if USE_SUDO else ["wg", "show", WG_INTERFACE]), capture_output=True, text=True, check=False).returncode == 0


def load_state():
    if not STATE_PATH.exists():
        return {"device_names": {}, "generated_configs": {}, "ui_settings": {}, "disabled_peers": {}, "backups": [], "geo_cache": {}, "analytics": []}
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"device_names": {}, "generated_configs": {}, "ui_settings": {}, "disabled_peers": {}, "backups": [], "geo_cache": {}, "analytics": []}
    data.setdefault("device_names", {})
    data.setdefault("generated_configs", {})
    data.setdefault("ui_settings", {})
    data.setdefault("disabled_peers", {})
    data.setdefault("backups", [])
    data.setdefault("geo_cache", {})
    data.setdefault("analytics", [])
    return data


def save_state(state):
    STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("authenticated"):
            return redirect(url_for("login"))
        return view(*args, **kwargs)
    return wrapped


def agent_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not AGENT_TOKEN:
            return jsonify({"error": "WG_AGENT_TOKEN is not configured."}), 503
        provided = request.headers.get("x-cloudos-vpn-token", "")
        if not hmac.compare_digest(provided, AGENT_TOKEN):
            return jsonify({"error": "Unauthorized"}), 401
        return view(*args, **kwargs)
    return wrapped


def hash_password(password, salt=None):
    raw_salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), raw_salt, 200000)
    return f"pbkdf2_sha256$200000${base64.b64encode(raw_salt).decode('ascii')}${base64.b64encode(digest).decode('ascii')}"


def verify_password(password):
    if LOGIN_PASSWORD_HASH:
        try:
            algorithm, rounds, salt_b64, digest_b64 = LOGIN_PASSWORD_HASH.split("$", 3)
            if algorithm != "pbkdf2_sha256":
                return False
            salt = base64.b64decode(salt_b64.encode("ascii"))
            expected = base64.b64decode(digest_b64.encode("ascii"))
            derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(rounds))
            return hmac.compare_digest(derived, expected)
        except Exception:
            return False
    return hmac.compare_digest(password, LOGIN_PASSWORD)


def make_qr_data_uri(text):
    if qrcode is None or not text:
        return ""
    image = qrcode.make(text)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def get_ui_settings(state):
    settings = state.get("ui_settings", {})
    return {
        "endpoint": settings.get("endpoint", DEFAULT_SERVER_ENDPOINT),
        "dns": settings.get("dns", DEFAULT_DNS),
        "allowed_ips": settings.get("allowed_ips", DEFAULT_ALLOWED_IPS),
        "refresh_seconds": int(settings.get("refresh_seconds", REFRESH_SECONDS)),
    }


def extract_host(value):
    candidate = (value or "").strip()
    if not candidate:
        return ""
    if "://" not in candidate:
        candidate = f"udp://{candidate}"
    parsed = urlparse(candidate)
    return parsed.hostname or ""


def lookup_geo(endpoint, state):
    host = extract_host(endpoint)
    if not host:
        return {}
    cache = state.get("geo_cache", {})
    cached = cache.get(host)
    if cached:
        return cached
    try:
        with urlopen(f"http://ip-api.com/json/{host}?fields=status,country,city,query", timeout=2) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if payload.get("status") == "success":
            geo = {"country": payload.get("country", ""), "city": payload.get("city", ""), "ip": payload.get("query", host)}
            cache[host] = geo
            state["geo_cache"] = cache
            save_state(state)
            return geo
    except Exception:
        return {}
    return {}


def add_analytics_sample(state, peers, stats):
    now = int(time.time())
    samples = [sample for sample in state.get("analytics", []) if now - sample.get("ts", 0) < 86400]
    if not samples or now - samples[-1].get("ts", 0) >= 300:
        sample = {
            "ts": now,
            "online": stats["online_peers"],
            "peers": stats["total_peers"],
            "rx_mb": round(sum(peer.get("rx_bytes", 0) for peer in peers) / 1048576, 2),
            "tx_mb": round(sum(peer.get("tx_bytes", 0) for peer in peers) / 1048576, 2),
        }
        samples.append(sample)
        state["analytics"] = samples[-48:]
        save_state(state)
    return state["analytics"]


def build_analytics_chart(samples):
    if not samples:
        return ""
    recent = samples[-12:]
    max_value = max(max(sample.get("rx_mb", 0), sample.get("tx_mb", 0), 1) for sample in recent)
    points_rx = []
    points_tx = []
    labels = []
    for index, sample in enumerate(recent):
        x = 20 + index * 42
        rx_y = 180 - int((sample.get("rx_mb", 0) / max_value) * 140)
        tx_y = 180 - int((sample.get("tx_mb", 0) / max_value) * 140)
        points_rx.append(f"{x},{rx_y}")
        points_tx.append(f"{x},{tx_y}")
        labels.append({"x": x, "label": time.strftime("%H:%M", time.localtime(sample.get("ts", 0)))})
    return {
        "rx_points": " ".join(points_rx),
        "tx_points": " ".join(points_tx),
        "labels": labels,
        "latest_rx_mb": recent[-1].get("rx_mb", 0),
        "latest_tx_mb": recent[-1].get("tx_mb", 0),
    }


def config_exists():
    try:
        if USE_SUDO:
            return subprocess.run(["sudo", "-n", "test", "-e", str(WG_CONFIG_PATH)], capture_output=True, text=True, check=False).returncode == 0
        return WG_CONFIG_PATH.exists()
    except OSError:
        return False


def read_config_text():
    try:
        if USE_SUDO:
            result = subprocess.run(["sudo", "-n", "cat", str(WG_CONFIG_PATH)], capture_output=True, text=True, check=False)
            if result.returncode == 0:
                return result.stdout
            if "No such file" in (result.stderr or ""):
                return None
            raise RuntimeError(f"Could not read {WG_CONFIG_PATH} via sudo: {result.stderr.strip() or result.stdout.strip()}")
        return WG_CONFIG_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except PermissionError as exc:
        raise RuntimeError(f"Permission denied reading {WG_CONFIG_PATH}. Run the dashboard with read access to the WireGuard config.") from exc
    except OSError as exc:
        raise RuntimeError(f"Could not read {WG_CONFIG_PATH}: {exc}") from exc


def write_config_text(content):
    try:
        if USE_SUDO:
            result = subprocess.run(["sudo", "-n", "tee", str(WG_CONFIG_PATH)], input=content, text=True, capture_output=True, check=False)
            if result.returncode != 0:
                raise RuntimeError(f"Could not write {WG_CONFIG_PATH} via sudo: {result.stderr.strip() or result.stdout.strip()}")
            return
        WG_CONFIG_PATH.write_text(content, encoding="utf-8")
    except PermissionError as exc:
        raise RuntimeError(f"Permission denied writing {WG_CONFIG_PATH}. Run the dashboard with write access to the WireGuard config.") from exc
    except OSError as exc:
        raise RuntimeError(f"Could not write {WG_CONFIG_PATH}: {exc}") from exc


def backup_config_text(content):
    backup_path = Path(f"{WG_CONFIG_PATH}.{time.strftime('%Y%m%d-%H%M%S')}.bak")
    try:
        if USE_SUDO:
            result = subprocess.run(["sudo", "-n", "tee", str(backup_path)], input=content, text=True, capture_output=True, check=False)
            if result.returncode != 0:
                raise RuntimeError(f"Could not write backup {backup_path} via sudo: {result.stderr.strip() or result.stdout.strip()}")
            return str(backup_path)
        backup_path.write_text(content, encoding="utf-8")
        return str(backup_path)
    except OSError as exc:
        raise RuntimeError(f"Could not create backup {backup_path}: {exc}") from exc


def parse_wg_dump():
    output = run_command(["wg", "show", WG_INTERFACE, "dump"])
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("WireGuard returned no data.")

    server = lines[0].split("\t")
    interface = {
        "public_key": server[1] if len(server) > 1 else "",
        "listen_port": server[2] if len(server) > 2 else "",
        "fwmark": server[3] if len(server) > 3 else "",
    }

    peers = []
    for line in lines[1:]:
        parts = line.split("\t")
        if len(parts) < 8:
            continue
        peers.append(
            {
                "public_key": parts[0],
                "endpoint": parts[2] or "N/A",
                "allowed_ips": parts[3] or "N/A",
                "handshake_epoch": int(parts[4]) if len(parts) > 4 and parts[4].isdigit() else 0,
                "rx_bytes": int(parts[5]) if len(parts) > 5 and parts[5].isdigit() else 0,
                "tx_bytes": int(parts[6]) if len(parts) > 6 and parts[6].isdigit() else 0,
                "keepalive": parts[7] if len(parts) > 7 and parts[7] != "off" else "off",
            }
        )
    return interface, peers


def get_interface_addresses():
    result = subprocess.run(["ip", "-o", "addr", "show", "dev", WG_INTERFACE], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        return ""
    addresses = []
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[2] in {"inet", "inet6"}:
            addresses.append(parts[3])
    return ", ".join(addresses)


def get_system_info():
    return {
        "hostname": run_command(["hostname"], check=False) or "unknown-host",
        "uptime": run_command(["uptime", "-p"], check=False) or "unknown",
    }


def human_bytes(value):
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(value)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            return f"{int(size)} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024


def format_age(epoch):
    if not epoch:
        return "Never"
    seconds = max(int(time.time()) - epoch, 0)
    if seconds < 60:
        return f"{seconds}s ago"
    if seconds < 3600:
        return f"{seconds // 60}m ago"
    if seconds < 86400:
        return f"{seconds // 3600}h ago"
    return f"{seconds // 86400}d ago"


def short_key(key, width=10):
    return key if len(key) <= width * 2 else f"{key[:width]}...{key[-width:]}"


def peer_id_for_key(key):
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def sanitize_name(name):
    clean = "".join(ch for ch in name.strip() if ch.isalnum() or ch in {" ", "-", "_", "."})
    return clean[:64] or "Client"


def parse_config():
    config_text = read_config_text()
    if config_text is None:
        return {}, []

    interface_data = {}
    peers = []
    section = None
    block = []

    def flush_peer(lines):
        if not lines:
            return
        peer = {"__raw__": "[Peer]\n" + "\n".join(lines).strip() + "\n"}
        for raw in lines:
            stripped = raw.strip()
            if not stripped:
                continue
            if stripped.startswith("# Name:"):
                peer["Name"] = stripped.split(":", 1)[1].strip()
                continue
            if stripped.startswith("#"):
                continue
            if "=" in raw:
                key, value = [part.strip() for part in raw.split("=", 1)]
                peer[key] = value
        if peer:
            peers.append(peer)

    for raw in config_text.splitlines():
        stripped = raw.strip()
        if stripped == "[Interface]":
            if section == "Peer":
                flush_peer(block)
                block = []
            section = "Interface"
            continue
        if stripped == "[Peer]":
            if section == "Peer":
                flush_peer(block)
            block = []
            section = "Peer"
            continue

        if section == "Interface" and "=" in raw:
            key, value = [part.strip() for part in raw.split("=", 1)]
            interface_data[key] = value
        elif section == "Peer":
            block.append(raw)

    if section == "Peer":
        flush_peer(block)
    return interface_data, peers


def infer_pool(interface_config):
    addresses = interface_config.get("Address", "")
    used = set()
    network = None
    for raw in [part.strip() for part in addresses.split(",") if part.strip()]:
        try:
            iface = ipaddress.ip_interface(raw)
        except ValueError:
            continue
        used.add(str(iface.ip))
        if isinstance(iface.ip, ipaddress.IPv4Address) and network is None:
            network = iface.network
    return network, used


def next_available_ip(interface_config, peers):
    network, used = infer_pool(interface_config)
    if network is None:
        return ""
    for peer in peers:
        ips = peer.get("AllowedIPs", peer.get("allowed_ips", ""))
        for cidr in [item.strip() for item in ips.split(",") if item.strip()]:
            try:
                iface = ipaddress.ip_interface(cidr)
            except ValueError:
                continue
            if isinstance(iface.ip, ipaddress.IPv4Address):
                used.add(str(iface.ip))
    for host in network.hosts():
        if str(host) not in used:
            return f"{host}/32"
    return ""


def make_client_config(client_private_key, client_address, dns, server_public_key, preshared_key, endpoint, allowed_ips, keepalive):
    lines = [
        "[Interface]",
        f"PrivateKey = {client_private_key}",
        f"Address = {client_address}",
    ]
    if dns.strip():
        lines.append(f"DNS = {dns.strip()}")
    lines.extend(["", "[Peer]", f"PublicKey = {server_public_key}", f"PresharedKey = {preshared_key}"])
    if endpoint.strip():
        lines.append(f"Endpoint = {endpoint.strip()}")
    lines.append(f"AllowedIPs = {allowed_ips.strip() or DEFAULT_ALLOWED_IPS}")
    if keepalive.strip():
        lines.append(f"PersistentKeepalive = {keepalive.strip()}")
    return "\n".join(lines) + "\n"


def generate_keypair():
    private_key = run_command(["wg", "genkey"])
    public_key = run_command(["wg", "pubkey"], input_text=private_key + "\n")
    return private_key, public_key


def generate_psk():
    return run_command(["wg", "genpsk"])


def append_peer_to_config(name, public_key, preshared_key, address, keepalive):
    if read_config_text() is None:
        raise RuntimeError(f"WireGuard config not found at {WG_CONFIG_PATH}.")
    block = [
        "",
        "[Peer]",
        f"# Name: {name}",
        f"PublicKey = {public_key}",
        f"PresharedKey = {preshared_key}",
        f"AllowedIPs = {address}",
    ]
    if keepalive.strip():
        block.append(f"PersistentKeepalive = {keepalive.strip()}")
    current = read_config_text()
    if current is None:
        raise RuntimeError(f"WireGuard config not found at {WG_CONFIG_PATH}.")
    suffix = "\n".join(block) + "\n"
    write_config_text(current.rstrip() + suffix)


def append_raw_peer_block(raw_block):
    current = read_config_text()
    if current is None:
        raise RuntimeError(f"WireGuard config not found at {WG_CONFIG_PATH}.")
    write_config_text(current.rstrip() + "\n\n" + raw_block.strip() + "\n")


def remove_peer_from_config(peer_key):
    config_text = read_config_text()
    if config_text is None:
        return False
    lines = config_text.splitlines()
    new_lines = []
    block = []
    in_peer = False
    removed = False

    def block_matches(candidate):
        for line in candidate:
            stripped = line.strip()
            if stripped.startswith("PublicKey") and "=" in stripped:
                return stripped.split("=", 1)[1].strip() == peer_key
        return False

    def flush():
        nonlocal block, removed
        if not block:
            return
        if block_matches(block):
            removed = True
        else:
            new_lines.extend(block)
        block = []

    for line in lines:
        stripped = line.strip()
        if stripped == "[Peer]":
            if in_peer:
                flush()
            block = [line]
            in_peer = True
            continue
        if stripped == "[Interface]":
            if in_peer:
                flush()
                in_peer = False
            new_lines.append(line)
            continue
        if in_peer:
            block.append(line)
        else:
            new_lines.append(line)

    if in_peer:
        flush()
    if removed:
        write_config_text("\n".join(new_lines).rstrip() + "\n")
    return removed


def rename_peer_in_config(peer_key, name):
    config_text = read_config_text()
    if config_text is None:
        return
    lines = config_text.splitlines()
    updated = []
    in_target = False
    seen_name = False

    for line in lines:
        stripped = line.strip()
        if stripped == "[Peer]":
            in_target = False
            seen_name = False
            updated.append(line)
            continue
        if stripped.startswith("PublicKey") and "=" in stripped:
            current_key = stripped.split("=", 1)[1].strip()
            in_target = current_key == peer_key
            if in_target and not seen_name and updated and updated[-1].strip() == "[Peer]":
                updated.append(f"# Name: {name}")
                seen_name = True
            updated.append(line)
            continue
        if in_target and stripped.startswith("# Name:"):
            updated.append(f"# Name: {name}")
            seen_name = True
            continue
        updated.append(line)

    write_config_text("\n".join(updated) + "\n")


def update_peer_config(peer_key, allowed_ips, keepalive):
    config_text = read_config_text()
    if config_text is None:
        raise RuntimeError("WireGuard config not found.")
    lines = config_text.splitlines()
    updated = []
    in_target = False
    saw_allowed = False
    saw_keepalive = False

    for line in lines:
        stripped = line.strip()
        if stripped == "[Peer]":
            if in_target:
                if not saw_allowed:
                    updated.append(f"AllowedIPs = {allowed_ips}")
                if keepalive and not saw_keepalive:
                    updated.append(f"PersistentKeepalive = {keepalive}")
                if not keepalive and saw_keepalive:
                    pass
            in_target = False
            saw_allowed = False
            saw_keepalive = False
            updated.append(line)
            continue

        if stripped.startswith("PublicKey") and "=" in stripped:
            current_key = stripped.split("=", 1)[1].strip()
            if in_target:
                if not saw_allowed:
                    updated.append(f"AllowedIPs = {allowed_ips}")
                if keepalive and not saw_keepalive:
                    updated.append(f"PersistentKeepalive = {keepalive}")
            in_target = current_key == peer_key
            saw_allowed = False
            saw_keepalive = False
            updated.append(line)
            continue

        if in_target and stripped.startswith("AllowedIPs") and "=" in stripped:
            updated.append(f"AllowedIPs = {allowed_ips}")
            saw_allowed = True
            continue

        if in_target and stripped.startswith("PersistentKeepalive") and "=" in stripped:
            saw_keepalive = True
            if keepalive:
                updated.append(f"PersistentKeepalive = {keepalive}")
            continue

        updated.append(line)

    if in_target:
        if not saw_allowed:
            updated.append(f"AllowedIPs = {allowed_ips}")
        if keepalive and not saw_keepalive:
            updated.append(f"PersistentKeepalive = {keepalive}")

    write_config_text("\n".join(updated) + "\n")


def reload_interface_from_config():
    stripped = run_command(["wg-quick", "strip", str(WG_CONFIG_PATH)])
    with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as handle:
        handle.write(stripped)
        temp_path = handle.name
    try:
        run_command(["wg", "syncconf", WG_INTERFACE, temp_path])
    finally:
        Path(temp_path).unlink(missing_ok=True)


def resolve_peer_key(peer_id):
    state = load_state()
    for peer in get_dashboard_data()["peers"]:
        if peer.get("peer_id") == peer_id:
            return peer["public_key"]
    for key in state.get("disabled_peers", {}):
        if peer_id_for_key(key) == peer_id:
            return key
    raise RuntimeError("Peer not found.")


def get_dashboard_data():
    state = load_state()
    ui_settings = get_ui_settings(state)
    config_error = None
    config_text = ""
    try:
        config_interface, config_peers = parse_config()
        config_text = read_config_text() or ""
    except RuntimeError as exc:
        config_interface, config_peers = {}, []
        config_error = str(exc)
    up = interface_is_up()
    runtime_interface = {"public_key": "", "listen_port": ""}
    runtime_peers = []
    error = config_error

    if up:
        try:
            runtime_interface, runtime_peers = parse_wg_dump()
        except RuntimeError as exc:
            error = str(exc)

    config_by_key = {peer.get("PublicKey"): peer for peer in config_peers if peer.get("PublicKey")}
    names = state.get("device_names", {})
    peers = []
    total_rx = 0
    total_tx = 0
    latest_epoch = 0

    for peer in runtime_peers:
        key = peer["public_key"]
        config_peer = config_by_key.get(key, {})
        handshake_epoch = peer["handshake_epoch"]
        online = bool(handshake_epoch and time.time() - handshake_epoch < 180)
        total_rx += peer["rx_bytes"]
        total_tx += peer["tx_bytes"]
        latest_epoch = max(latest_epoch, handshake_epoch)
        peers.append(
            {
                **peer,
                "name": names.get(key) or config_peer.get("Name") or f"Peer {len(peers) + 1}",
                "peer_id": peer_id_for_key(key),
                "public_key_short": short_key(key),
                "rx_human": human_bytes(peer["rx_bytes"]),
                "tx_human": human_bytes(peer["tx_bytes"]),
                "handshake_ago": format_age(handshake_epoch),
                "online": online,
                "seen_before": handshake_epoch > 0,
                "disabled": key in state.get("disabled_peers", {}),
            }
        )

    runtime_keys = {peer["public_key"] for peer in runtime_peers}
    for config_peer in config_peers:
        key = config_peer.get("PublicKey")
        if not key or key in runtime_keys:
            continue
        peers.append(
            {
                "public_key": key,
                "peer_id": peer_id_for_key(key),
                "public_key_short": short_key(key),
                "name": names.get(key) or config_peer.get("Name") or f"Peer {len(peers) + 1}",
                "endpoint": "N/A",
                "allowed_ips": config_peer.get("AllowedIPs", "N/A"),
                "handshake_ago": "Pending activation",
                "keepalive": config_peer.get("PersistentKeepalive", "off"),
                "rx_human": "0 B",
                "tx_human": "0 B",
                "online": False,
                "seen_before": False,
                "disabled": key in state.get("disabled_peers", {}),
            }
        )

    known_keys = {peer["public_key"] for peer in peers}
    for key, disabled_meta in state.get("disabled_peers", {}).items():
        if key in known_keys:
            continue
        peers.append(
            {
                "public_key": key,
                "peer_id": peer_id_for_key(key),
                "public_key_short": short_key(key),
                "name": disabled_meta.get("name", names.get(key, "Disabled Peer")),
                "endpoint": "Disabled",
                "allowed_ips": "Stored in backup block",
                "handshake_ago": "Disabled",
                "keepalive": "off",
                "rx_human": "0 B",
                "tx_human": "0 B",
                "online": False,
                "seen_before": False,
                "disabled": True,
            }
        )

    pool, _ = infer_pool(config_interface)
    public_key = runtime_interface.get("public_key", "")
    for peer in peers:
        disabled_meta = state.get("disabled_peers", {}).get(peer["public_key"], {})
        peer["blocked_until"] = disabled_meta.get("blocked_until", 0)
        if peer["blocked_until"] and peer["blocked_until"] <= time.time():
            state["disabled_peers"].pop(peer["public_key"], None)
            save_state(state)
            peer["blocked_until"] = 0
        peer["blocked_until_human"] = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(peer["blocked_until"])) if peer["blocked_until"] else ""
        peer["geo"] = lookup_geo(peer.get("endpoint", ""), state)

    stats = {
        "total_peers": len(peers),
        "online_peers": sum(1 for peer in peers if peer["online"]),
        "total_rx": human_bytes(total_rx),
        "total_tx": human_bytes(total_tx),
        "latest_handshake": format_age(latest_epoch),
        "next_ip": next_available_ip(config_interface, config_peers),
        "pool": str(pool) if pool else "",
        "disabled_peers": sum(1 for peer in peers if peer.get("disabled")),
    }
    analytics = add_analytics_sample(state, peers, stats)
    chart = build_analytics_chart(analytics)
    generated_peer = state.get("generated_configs", {}).get("last")
    if generated_peer:
        generated_peer = {**generated_peer, "qr_data_uri": make_qr_data_uri(generated_peer.get("client_config", ""))}
    generated_configs = []
    for key, value in state.get("generated_configs", {}).items():
        if key == "last":
            continue
        generated_configs.append({**value, "qr_data_uri": make_qr_data_uri(value.get("client_config", ""))})
    return {
        "system": get_system_info(),
        "interface": {
            "name": WG_INTERFACE,
            "up": up,
            "public_key": public_key,
            "public_key_short": short_key(public_key) if public_key else "Unavailable",
            "listen_port": runtime_interface.get("listen_port") or config_interface.get("ListenPort", ""),
            "addresses": get_interface_addresses() or config_interface.get("Address", ""),
            "endpoint_hint": ui_settings["endpoint"],
            "config_accessible": config_error is None,
        },
        "peers": sorted(peers, key=lambda item: (not item["online"], item["name"].lower())),
        "stats": stats,
        "defaults": {
            "dns": ui_settings["dns"],
            "allowed_ips": ui_settings["allowed_ips"],
            "refresh_seconds": ui_settings["refresh_seconds"],
        },
        "generated_peer": generated_peer,
        "generated_configs": generated_configs,
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "config_path": str(WG_CONFIG_PATH),
        "config_text": config_text,
        "analytics": analytics,
        "analytics_chart": chart,
        "backups": state.get("backups", [])[-8:][::-1],
        "qrcode_available": qrcode is not None,
        "error": error,
    }


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        if request.form.get("username") == LOGIN_USERNAME and verify_password(request.form.get("password", "")):
            session["authenticated"] = True
            return redirect(url_for("dashboard"))
        flash("Invalid credentials.")
    return render_template_string(LOGIN_HTML)


@app.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def dashboard():
    data = get_dashboard_data()
    if data["error"]:
        flash(data["error"])
    return render_template_string(HTML, refresh_seconds=data["defaults"]["refresh_seconds"], **data)


@app.post("/interface/<action>")
@login_required
def interface_action(action):
    try:
        if action == "start":
            run_command(["wg-quick", "up", WG_INTERFACE])
            flash("Interface started.")
        elif action == "stop":
            run_command(["wg-quick", "down", WG_INTERFACE])
            flash("Interface stopped.")
        elif action == "restart":
            subprocess.run(["wg-quick", "down", WG_INTERFACE], capture_output=True, text=True, check=False)
            run_command(["wg-quick", "up", WG_INTERFACE])
            flash("Interface restarted.")
        elif action == "save":
            run_command(["wg-quick", "save", WG_INTERFACE])
            flash("Runtime state saved to config.")
        elif action == "reload":
            reload_interface_from_config()
            flash("Config reloaded into live interface.")
        else:
            abort(404)
    except RuntimeError as exc:
        flash(str(exc))
    return redirect(url_for("dashboard"))


@app.post("/config/save")
@login_required
def save_config():
    try:
        existing = read_config_text()
        if existing is None:
            raise RuntimeError(f"WireGuard config not found at {WG_CONFIG_PATH}.")
        new_config = request.form.get("config_text", "")
        if not new_config.strip():
            raise RuntimeError("Config cannot be empty.")
        backup_path = backup_config_text(existing)
        write_config_text(new_config.rstrip() + "\n")
        if request.form.get("apply_now") == "1":
            reload_interface_from_config()
            flash(f"Config saved and applied. Backup: {backup_path}")
        else:
            flash(f"Config saved. Backup: {backup_path}")
    except RuntimeError as exc:
        flash(str(exc))
    return redirect(url_for("dashboard"))


@app.post("/settings/save")
@login_required
def save_settings():
    state = load_state()
    raw_refresh = request.form.get("refresh_seconds", str(REFRESH_SECONDS)).strip()
    try:
        refresh_seconds = max(5, int(raw_refresh or REFRESH_SECONDS))
    except ValueError:
        refresh_seconds = REFRESH_SECONDS
    state["ui_settings"] = {
        "endpoint": request.form.get("endpoint", "").strip(),
        "dns": request.form.get("dns", DEFAULT_DNS).strip(),
        "allowed_ips": request.form.get("allowed_ips", DEFAULT_ALLOWED_IPS).strip(),
        "refresh_seconds": refresh_seconds,
    }
    save_state(state)
    flash("Dashboard defaults updated.")
    return redirect(url_for("dashboard"))


@app.get("/api/dashboard")
@login_required
def dashboard_api():
    data = get_dashboard_data()
    return jsonify(
        {
            "stats": data["stats"],
            "interface": {"up": data["interface"]["up"], "listen_port": data["interface"]["listen_port"]},
            "peers": [
                {
                    "peer_id": peer["peer_id"],
                    "online": peer["online"],
                    "handshake_ago": peer["handshake_ago"],
                    "rx_human": peer["rx_human"],
                    "tx_human": peer["tx_human"],
                    "disabled": peer.get("disabled", False),
                }
                for peer in data["peers"]
            ],
        }
    )


@app.get("/clients/<peer_id>/download")
@login_required
def download_client(peer_id):
    peer_key = resolve_peer_key(peer_id)
    state = load_state()
    config = state.get("generated_configs", {}).get(peer_key)
    if not config:
        abort(404)
    return Response(
        config["client_config"],
        headers={"Content-Disposition": f'attachment; filename="{config["name"].replace(" ", "_")}.conf"'},
        mimetype="text/plain",
    )


@app.get("/clients/<peer_id>/qr")
@login_required
def client_qr(peer_id):
    if qrcode is None:
        abort(501)
    peer_key = resolve_peer_key(peer_id)
    state = load_state()
    config = state.get("generated_configs", {}).get(peer_key)
    if not config:
        abort(404)
    image = qrcode.make(config["client_config"])
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    return send_file(buffer, mimetype="image/png")


@app.post("/peers/<peer_id>/disable")
@login_required
def disable_peer(peer_id):
    try:
        peer_key = resolve_peer_key(peer_id)
        _, config_peers = parse_config()
        config_peer = next((peer for peer in config_peers if peer.get("PublicKey") == peer_key), None)
        if not config_peer:
            raise RuntimeError("Peer config block not found.")
        if interface_is_up():
            run_command(["wg", "set", WG_INTERFACE, "peer", peer_key, "remove"])
        remove_peer_from_config(peer_key)
        state = load_state()
        state["disabled_peers"][peer_key] = {
            "raw_block": config_peer.get("__raw__", ""),
            "blocked_until": 0,
            "name": state.get("device_names", {}).get(peer_key, config_peer.get("Name", "Peer")),
        }
        save_state(state)
        flash("Peer disabled without deleting.")
    except RuntimeError as exc:
        flash(str(exc))
    return redirect(url_for("dashboard"))


@app.post("/peers/<peer_id>/enable")
@login_required
def enable_peer(peer_id):
    try:
        peer_key = resolve_peer_key(peer_id)
        state = load_state()
        payload = state.get("disabled_peers", {}).get(peer_key)
        if not payload:
            raise RuntimeError("Peer is not disabled.")
        append_raw_peer_block(payload.get("raw_block", ""))
        state["disabled_peers"].pop(peer_key, None)
        save_state(state)
        if interface_is_up():
            reload_interface_from_config()
        flash("Peer enabled.")
    except RuntimeError as exc:
        flash(str(exc))
    return redirect(url_for("dashboard"))


@app.post("/peers/<peer_id>/block")
@login_required
def block_peer(peer_id):
    try:
        peer_key = resolve_peer_key(peer_id)
        minutes = max(1, int(request.form.get("minutes", "30")))
    except ValueError:
        minutes = 30
    response = disable_peer(peer_id)
    state = load_state()
    if peer_key in state.get("disabled_peers", {}):
        state["disabled_peers"][peer_key]["blocked_until"] = int(time.time()) + minutes * 60
        save_state(state)
    flash(f"Peer blocked for {minutes} minutes.")
    return response


@app.post("/peers/<peer_id>/reconnect")
@login_required
def reconnect_peer(peer_id):
    try:
        peer_key = resolve_peer_key(peer_id)
        if interface_is_up():
            run_command(["wg", "set", WG_INTERFACE, "peer", peer_key, "remove"])
            reload_interface_from_config()
        flash("Peer reconnect forced.")
    except RuntimeError as exc:
        flash(str(exc))
    return redirect(url_for("dashboard"))


@app.post("/backups/create")
@login_required
def create_backup():
    try:
        existing = read_config_text()
        if existing is None:
            raise RuntimeError("Config file not found.")
        backup_path = backup_config_text(existing)
        state = load_state()
        state["backups"].append({"path": backup_path, "created_at": time.strftime("%Y-%m-%d %H:%M:%S")})
        state["backups"] = state["backups"][-12:]
        save_state(state)
        flash(f"Backup created: {backup_path}")
    except RuntimeError as exc:
        flash(str(exc))
    return redirect(url_for("dashboard"))


@app.post("/backups/restore")
@login_required
def restore_backup():
    target = request.form.get("path", "").strip()
    if not target:
        flash("Backup path is required.")
        return redirect(url_for("dashboard"))
    try:
        if USE_SUDO:
            content = run_command(["cat", target])
        else:
            content = Path(target).read_text(encoding="utf-8")
        write_config_text(content)
        if interface_is_up():
            reload_interface_from_config()
        flash(f"Backup restored: {target}")
    except Exception as exc:
        flash(str(exc))
    return redirect(url_for("dashboard"))


@app.post("/peers/create")
@login_required
def create_peer():
    try:
        config_interface, config_peers = parse_config()
        address = request.form.get("address", "").strip() or next_available_ip(config_interface, config_peers)
        if not address:
            raise RuntimeError("Could not infer the next available client address. Set Address in wg0.conf or enter a client address manually.")

        name = sanitize_name(request.form.get("name", "Client"))
        state = load_state()
        ui_settings = get_ui_settings(state)
        dns = request.form.get("dns", ui_settings["dns"]).strip()
        allowed_ips = request.form.get("allowed_ips", ui_settings["allowed_ips"]).strip()
        endpoint = request.form.get("endpoint", ui_settings["endpoint"]).strip()
        keepalive = request.form.get("keepalive", "25").strip()

        client_private_key, client_public_key = generate_keypair()
        preshared_key = generate_psk()

        append_peer_to_config(name, client_public_key, preshared_key, address, keepalive)
        if interface_is_up():
            run_command(["wg", "set", WG_INTERFACE, "peer", client_public_key, "preshared-key", "/dev/stdin", "allowed-ips", address], input_text=preshared_key + "\n")

        state["device_names"][client_public_key] = name
        client_payload = {
            "name": name,
            "address": address,
            "public_key": client_public_key,
            "peer_id": peer_id_for_key(client_public_key),
            "client_config": make_client_config(
                client_private_key,
                address,
                dns,
                get_dashboard_data()["interface"]["public_key"],
                preshared_key,
                endpoint,
                allowed_ips,
                keepalive,
            ),
        }
        state["generated_configs"]["last"] = client_payload
        state["generated_configs"][client_public_key] = client_payload
        save_state(state)
        flash(f"Client '{name}' created.")
    except RuntimeError as exc:
        flash(str(exc))
    return redirect(url_for("dashboard"))


@app.post("/peers/<peer_id>/delete")
@login_required
def delete_peer(peer_id):
    try:
        peer_key = resolve_peer_key(peer_id)
        if interface_is_up():
            run_command(["wg", "set", WG_INTERFACE, "peer", peer_key, "remove"])
        remove_peer_from_config(peer_key)
        state = load_state()
        state["device_names"].pop(peer_key, None)
        save_state(state)
        flash("Peer removed.")
    except RuntimeError as exc:
        flash(str(exc))
    return redirect(url_for("dashboard"))


@app.post("/peers/<peer_id>/rename")
@login_required
def rename_peer(peer_id):
    try:
        peer_key = resolve_peer_key(peer_id)
        name = sanitize_name(request.form.get("name", "Client"))
        state = load_state()
        state["device_names"][peer_key] = name
        save_state(state)
        rename_peer_in_config(peer_key, name)
        flash("Peer renamed.")
    except RuntimeError as exc:
        flash(str(exc))
    return redirect(url_for("dashboard"))


@app.post("/peers/<peer_id>/update")
@login_required
def update_peer(peer_id):
    try:
        peer_key = resolve_peer_key(peer_id)
        allowed_ips = request.form.get("allowed_ips", "").strip()
        keepalive = request.form.get("keepalive", "").strip()
        if not allowed_ips:
            raise RuntimeError("AllowedIPs is required.")
        update_peer_config(peer_key, allowed_ips, keepalive)
        if interface_is_up():
            reload_interface_from_config()
        flash("Peer routing updated.")
    except RuntimeError as exc:
        flash(str(exc))
    return redirect(url_for("dashboard"))


@app.get("/api/agent/dashboard")
@agent_required
def agent_dashboard():
    data = get_dashboard_data()
    return jsonify(data)


@app.get("/api/agent/system")
@agent_required
def agent_system():
    return jsonify(get_system_info())


@app.post("/api/agent/interface/<action>")
@agent_required
def agent_interface_action(action):
    try:
        if action == "start":
            run_command(["wg-quick", "up", WG_INTERFACE])
        elif action == "stop":
            run_command(["wg-quick", "down", WG_INTERFACE])
        elif action == "restart":
            subprocess.run(["wg-quick", "down", WG_INTERFACE], capture_output=True, text=True, check=False)
            run_command(["wg-quick", "up", WG_INTERFACE])
        elif action == "save":
            run_command(["wg-quick", "save", WG_INTERFACE])
        elif action == "reload":
            reload_interface_from_config()
        else:
            abort(404)
        return ("", 204)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 400


@app.post("/api/agent/settings")
@agent_required
def agent_save_settings():
    payload = request.get_json(silent=True) or {}
    state = load_state()
    raw_refresh = str(payload.get("refreshSeconds", REFRESH_SECONDS)).strip()
    try:
        refresh_seconds = max(5, int(raw_refresh or REFRESH_SECONDS))
    except ValueError:
        refresh_seconds = REFRESH_SECONDS
    state["ui_settings"] = {
        "endpoint": str(payload.get("endpoint", "")).strip(),
        "dns": str(payload.get("dns", DEFAULT_DNS)).strip(),
        "allowed_ips": str(payload.get("allowedIps", DEFAULT_ALLOWED_IPS)).strip(),
        "refresh_seconds": refresh_seconds,
    }
    save_state(state)
    return ("", 204)


@app.post("/api/agent/peers")
@agent_required
def agent_create_peer():
    payload = request.get_json(silent=True) or {}
    try:
        config_interface, config_peers = parse_config()
        address = str(payload.get("address", "")).strip() or next_available_ip(config_interface, config_peers)
        if not address:
            raise RuntimeError("Could not infer the next available client address. Set Address in wg0.conf or enter a client address manually.")

        name = sanitize_name(str(payload.get("name", "Client")))
        state = load_state()
        ui_settings = get_ui_settings(state)
        dns = str(payload.get("dns", ui_settings["dns"])).strip()
        allowed_ips = str(payload.get("allowedIps", ui_settings["allowed_ips"])).strip()
        endpoint = str(payload.get("endpoint", ui_settings["endpoint"])).strip()
        keepalive = str(payload.get("keepalive", "25")).strip()

        client_private_key, client_public_key = generate_keypair()
        preshared_key = generate_psk()

        append_peer_to_config(name, client_public_key, preshared_key, address, keepalive)
        if interface_is_up():
            run_command(["wg", "set", WG_INTERFACE, "peer", client_public_key, "preshared-key", "/dev/stdin", "allowed-ips", address], input_text=preshared_key + "\n")

        state["device_names"][client_public_key] = name
        client_payload = {
            "name": name,
            "address": address,
            "publicKey": client_public_key,
            "peerId": peer_id_for_key(client_public_key),
            "clientConfig": make_client_config(
                client_private_key,
                address,
                dns,
                get_dashboard_data()["interface"]["public_key"],
                preshared_key,
                endpoint,
                allowed_ips,
                keepalive,
            ),
        }
        state["generated_configs"]["last"] = client_payload
        state["generated_configs"][client_public_key] = client_payload
        save_state(state)
        return jsonify(client_payload), 201
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 400


@app.post("/api/agent/config")
@agent_required
def agent_save_config():
    payload = request.get_json(silent=True) or {}
    try:
        existing = read_config_text()
        if existing is None:
            raise RuntimeError(f"WireGuard config not found at {WG_CONFIG_PATH}.")
        new_config = str(payload.get("configText", ""))
        if not new_config.strip():
            raise RuntimeError("Config cannot be empty.")
        backup_config_text(existing)
        write_config_text(new_config.rstrip() + "\n")
        return ("", 204)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 400


@app.get("/api/agent/backups")
@agent_required
def agent_list_backups():
    return jsonify(load_state().get("backups", [])[-12:][::-1])


@app.post("/api/agent/backups")
@agent_required
def agent_create_backup():
    try:
        existing = read_config_text()
        if existing is None:
            raise RuntimeError("Config file not found.")
        backup_path = backup_config_text(existing)
        state = load_state()
        state["backups"].append({"path": backup_path, "created_at": time.strftime("%Y-%m-%d %H:%M:%S")})
        state["backups"] = state["backups"][-12:]
        save_state(state)
        return jsonify({"path": backup_path}), 201
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 400


@app.post("/api/agent/backups/restore")
@agent_required
def agent_restore_backup():
    payload = request.get_json(silent=True) or {}
    target = str(payload.get("path", "")).strip()
    if not target:
        return jsonify({"error": "Backup path is required."}), 400
    try:
        if USE_SUDO:
            content = run_command(["cat", target])
        else:
            content = Path(target).read_text(encoding="utf-8")
        write_config_text(content)
        if interface_is_up():
            reload_interface_from_config()
        return ("", 204)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.get("/api/agent/clients/<peer_id>/download")
@agent_required
def agent_download_client(peer_id):
    peer_key = resolve_peer_key(peer_id)
    state = load_state()
    config = state.get("generated_configs", {}).get(peer_key)
    if not config:
        return jsonify({"error": "Generated config not found"}), 404
    return Response(
        config["clientConfig"] if "clientConfig" in config else config["client_config"],
        headers={"Content-Disposition": f'attachment; filename="{config["name"].replace(" ", "_")}.conf"'},
        mimetype="text/plain",
    )


@app.post("/api/agent/peers/<peer_id>/rename")
@agent_required
def agent_rename_peer(peer_id):
    payload = request.get_json(silent=True) or {}
    try:
        peer_key = resolve_peer_key(peer_id)
        name = sanitize_name(str(payload.get("name", "Client")))
        state = load_state()
        state["device_names"][peer_key] = name
        save_state(state)
        rename_peer_in_config(peer_key, name)
        return ("", 204)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 400


@app.post("/api/agent/peers/<peer_id>/update")
@agent_required
def agent_update_peer(peer_id):
    payload = request.get_json(silent=True) or {}
    try:
        peer_key = resolve_peer_key(peer_id)
        allowed_ips = str(payload.get("allowedIps", "")).strip()
        keepalive = str(payload.get("keepalive", "")).strip()
        if not allowed_ips:
            raise RuntimeError("AllowedIPs is required.")
        update_peer_config(peer_key, allowed_ips, keepalive)
        if interface_is_up():
            reload_interface_from_config()
        return ("", 204)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 400


@app.post("/api/agent/peers/<peer_id>/disable")
@agent_required
def agent_disable_peer(peer_id):
    try:
        peer_key = resolve_peer_key(peer_id)
        _, config_peers = parse_config()
        config_peer = next((peer for peer in config_peers if peer.get("PublicKey") == peer_key), None)
        if not config_peer:
            raise RuntimeError("Peer config block not found.")
        if interface_is_up():
            run_command(["wg", "set", WG_INTERFACE, "peer", peer_key, "remove"])
        remove_peer_from_config(peer_key)
        state = load_state()
        state["disabled_peers"][peer_key] = {
            "raw_block": config_peer.get("__raw__", ""),
            "blocked_until": 0,
            "name": state.get("device_names", {}).get(peer_key, config_peer.get("Name", "Peer")),
        }
        save_state(state)
        return ("", 204)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 400


@app.post("/api/agent/peers/<peer_id>/enable")
@agent_required
def agent_enable_peer(peer_id):
    try:
        peer_key = resolve_peer_key(peer_id)
        state = load_state()
        payload = state.get("disabled_peers", {}).get(peer_key)
        if not payload:
            raise RuntimeError("Peer is not disabled.")
        append_raw_peer_block(payload.get("raw_block", ""))
        state["disabled_peers"].pop(peer_key, None)
        save_state(state)
        if interface_is_up():
            reload_interface_from_config()
        return ("", 204)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 400


@app.post("/api/agent/peers/<peer_id>/block")
@agent_required
def agent_block_peer(peer_id):
    payload = request.get_json(silent=True) or {}
    try:
        minutes = max(1, int(payload.get("minutes", 30)))
    except ValueError:
        minutes = 30
    disable_response = agent_disable_peer(peer_id)
    if isinstance(disable_response, tuple) and disable_response[1] >= 400:
        return disable_response
    peer_key = resolve_peer_key(peer_id)
    state = load_state()
    if peer_key in state.get("disabled_peers", {}):
        state["disabled_peers"][peer_key]["blocked_until"] = int(time.time()) + minutes * 60
        save_state(state)
    return ("", 204)


@app.post("/api/agent/peers/<peer_id>/reconnect")
@agent_required
def agent_reconnect_peer(peer_id):
    try:
        peer_key = resolve_peer_key(peer_id)
        if interface_is_up():
            run_command(["wg", "set", WG_INTERFACE, "peer", peer_key, "remove"])
            reload_interface_from_config()
        return ("", 204)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 400


@app.delete("/api/agent/peers/<peer_id>")
@agent_required
def agent_delete_peer(peer_id):
    try:
        peer_key = resolve_peer_key(peer_id)
        if interface_is_up():
            run_command(["wg", "set", WG_INTERFACE, "peer", peer_key, "remove"])
        remove_peer_from_config(peer_key)
        state = load_state()
        state["device_names"].pop(peer_key, None)
        save_state(state)
        return ("", 204)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 400


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")))
