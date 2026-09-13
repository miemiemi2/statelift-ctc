#!/usr/bin/env python3
"""Render English whitepaper with Markdown and local Chromium; no upload."""
import pathlib, subprocess, sys
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
source = root / 'docs/WHITEPAPER.md'
out = root / 'submission'
out.mkdir(exist_ok=True)
md = source.read_text()
md = '\n'.join(md.splitlines()[2:])
converted = subprocess.run(['/root/.local/share/codex-workbench/venv/bin/python','-c',
 'import sys,markdown; print(markdown.markdown(sys.stdin.read(),extensions=["tables","toc","fenced_code"]))'],
 input='[TOC]\n\n'+md, text=True, capture_output=True, check=True).stdout
css = '''
@page { size:A4; margin:25.4mm; }
* { box-sizing:border-box; }
body { font-family:Arial,"Liberation Sans",sans-serif; color:#17262e; font-size:10pt; line-height:1.45; }
.cover { height:225mm; break-after:page; display:flex; flex-direction:column; justify-content:center; }
.kicker { letter-spacing:.14em; font-size:9pt; color:#40747e; text-transform:uppercase; }
.cover h1 { font-size:48pt; letter-spacing:-.055em; margin:20px 0 10px; }
.cover .sub { font-size:22pt; line-height:1.2; max-width:490px; color:#276573; }
.cover .promise { margin-top:35px; border-left:3px solid #cc7950; padding-left:18px; font-size:12pt; }
.cover .meta { margin-top:48px; color:#607680; font-size:10pt; }
h2 { margin:24px 0 10px; font-size:16pt; color:#245c68; break-after:avoid; }
h3 { break-after:avoid; }
p,li { orphans:3; widows:3; }
p { margin:0 0 11px; }
a { color:#23677a; text-decoration:none; overflow-wrap:anywhere; }
strong { font-weight:700; }
code { font-size:9pt; overflow-wrap:anywhere; }
table { border-collapse:collapse; width:100%; table-layout:fixed; break-inside:avoid; margin:16px 0; font-size:9pt; }
th { background:#e9f1f2; color:#174b58; text-align:left; }
td,th { border-bottom:1px solid #ccdade; padding:8px; vertical-align:top; overflow-wrap:anywhere; }
tr { break-inside:avoid; }
.toc { border-top:2px solid #245c68; padding-top:12px; margin-bottom:30px; }
.toc:before { content:"Contents"; font-weight:bold; font-size:17pt; color:#245c68; }
.toc ul { list-style:none; padding:0; }
.toc li { margin:5px 0; }
'''
cover='''<section class="cover"><div class="kicker">Creditcoin · Attestcoin · September 2026</div><h1>StateLift</h1><div class="sub">Bounded budget recovery.<br>Safe payment handoff.</div><p class="promise">One payment goal. At most one compliant payment.<br>Recover the budget at D. Let dedicated B carry the late obligation.</p><div class="meta">Technical whitepaper<br>Real testnet prototype · Experimental economics</div></section>'''
html='<!doctype html><html lang="en"><meta charset="utf-8"><title>StateLift whitepaper</title><style>'+css+'</style><body>'+cover+converted+'</body></html>'
html_path=out/'StateLift-whitepaper.html';html_path.write_text(html)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/root/.cache/ms-playwright/chromium-1234/chrome-linux/chrome',headless=True,args=['--no-sandbox'])
 page=browser.new_page();page.goto(html_path.as_uri());page.evaluate('document.fonts.ready')
 page.pdf(path=str(out/'StateLift-whitepaper.pdf'),format='A4',print_background=True,prefer_css_page_size=True,display_header_footer=True,outline=True,tagged=True,
 header_template='<div style="font-size:8px;width:100%;margin:0 25.4mm;color:#667b82">STATELIFT · TECHNICAL WHITEPAPER</div>',
 footer_template='<div style="font-size:8px;width:100%;margin:0 25.4mm;color:#667b82;text-align:right"><span class="pageNumber"></span> / <span class="totalPages"></span></div>')
 browser.close()
print(out/'StateLift-whitepaper.pdf')
