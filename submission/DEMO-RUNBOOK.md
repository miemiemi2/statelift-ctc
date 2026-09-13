# StateLift demonstration

Open https://miemiemi2.github.io/statelift-ctc/web/demo.html .

Use **Next scene** to move through the three independently recorded cases: same-goal handoff, late settlement from dedicated guarantee, and unfilled expiry. **Previous** revisits a scene; the final button restarts the demonstration.

The page loads saved testnet evidence. It does not send transactions. Case A, B and C have different goal IDs; they must not be presented as one continuous payment history. A credit is withdrawable escrow ownership, not evidence of a completed withdrawal.

In the expiry outcome scene, **Verify expiry live** queries public RPC and calls the deployed verifier. Success is shown only after the live checks pass. If RPC is unavailable, the page reports an incomplete live check separately from the recorded outcome; retry when available.

Each case has expandable transaction links and a link to the full verifier. For a local copy, serve the repository root with `python3 -m http.server 8080` and open `http://localhost:8080/web/demo.html`.
