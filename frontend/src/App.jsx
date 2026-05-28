import { useState, useRef, useCallback, useEffect } from "react";

/* ─── helpers ─────────────────────────────────────────────── */
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_FILE_BYTES  = 5 * 1024 * 1024; // Anthropic's 5 MB limit

// Detect real format from magic bytes — browser file.type trusts the extension,
// which is wrong for renamed files (e.g. a JPEG saved as .png).
const detectMediaType = async (file) => {
  const buf   = await file.slice(0, 12).arrayBuffer();
  const b     = new Uint8Array(buf);
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return file.type; // unknown — fall back and let validation catch it
};

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

const extractMetadata = (file) => ({
  name: file.name,
  size: `${(file.size / 1024).toFixed(1)} KB`,
  type: file.type,
  lastModified: new Date(file.lastModified).toLocaleString(),
});

function useWindowWidth() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1024);
  useEffect(() => {
    const fn = () => setW(window.innerWidth);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return w;
}

// API base – empty string = same origin (nginx proxies /api → backend)
const API_BASE = import.meta.env.VITE_API_URL || "";

/* ─── component ───────────────────────────────────────────── */
export default function App() {
  const [image,    setImage]    = useState(null);
  const [urlInput, setUrlInput] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [phase,    setPhase]    = useState("idle");
  const fileRef = useRef();
  const width   = useWindowWidth();

  const isMobile  = width < 640;
  const isTablet  = width >= 640 && width < 1024;
  const isDesktop = width >= 1024;
  const two       = isDesktop || isTablet;

  /* ── load file ── */
  const loadFile = async (file) => {
    if (!file || !file.type.startsWith("image/")) {
      setError("Please provide a valid image file."); return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(`Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.`); return;
    }
    const mediaType = await detectMediaType(file);
    if (!SUPPORTED_TYPES.has(mediaType)) {
      setError(`Unsupported format (${mediaType}). Please convert to JPEG, PNG, GIF, or WebP first.`); return;
    }
    const base64 = await fileToBase64(file);
    const src    = URL.createObjectURL(file);
    setImage({ src, base64, mediaType, meta: extractMetadata(file), mode: "base64" });
    setResult(null); setError(null); setPhase("uploaded");
  };

  /* ── load url ── */
  const loadUrl = async () => {
    if (!urlInput.trim()) return;
    setLoading(true); setError(null);
    try {
      const trimmed  = urlInput.trim();
      const namePart = trimmed.split("?")[0].split("/").pop() || "image";
      const isGoogle = trimmed.includes("googleusercontent.com") || trimmed.includes("googleapis.com");
      setImage({
        src: trimmed, mode: "url", urlDirect: trimmed,
        mediaType: "image/jpeg",
        meta: {
          name: namePart,
          source: isGoogle ? "Google User Content" : "External URL",
          url: trimmed.length > 55 ? trimmed.slice(0, 52) + "…" : trimmed,
        },
      });
      setResult(null); setPhase("uploaded");
    } catch {
      setError("Could not load image from URL. Try uploading directly.");
    } finally { setLoading(false); }
  };

  /* ── analyse ── */
  const analyze = useCallback(async () => {
    if (!image) return;
    setLoading(true); setPhase("analyzing"); setError(null); setResult(null);

    const imageSource = image.mode === "url"
      ? { type: "url",    url: image.urlDirect }
      : { type: "base64", media_type: image.mediaType, data: image.base64 };

    try {
      const res = await fetch(`${API_BASE}/api/analyse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageSource, metadata: image.meta }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }
      const parsed = await res.json();
      setResult(parsed); setPhase("done");
    } catch (err) {
      setError(err.message || "Analysis failed. Please try again."); setPhase("uploaded");
    } finally { setLoading(false); }
  }, [image]);

  const reset = () => {
    setImage(null); setResult(null); setError(null); setUrlInput(""); setPhase("idle");
  };

  return (
    <div style={S.root}>
      <div style={S.scanlines} />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Rajdhani:wght@500;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { -webkit-text-size-adjust: 100%; }
        body { background: #080c10; overscroll-behavior: none; }
        input, button { -webkit-appearance: none; border-radius: 0; }
        @keyframes spin   { to { transform: rotate(360deg); } }
        @keyframes pulse  { 0%,100%{opacity:.35} 50%{opacity:1} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
        @keyframes glow   { 0%,100%{text-shadow:0 0 20px rgba(0,255,200,.15)} 50%{text-shadow:0 0 40px rgba(0,255,200,.4)} }
      `}</style>

      <div style={{ ...S.container, padding: isMobile ? "28px 16px 56px" : "40px 24px 64px" }}>

        {/* header */}
        <header style={{ ...S.header, marginBottom: isMobile ? 32 : 48 }}>
          <div style={S.badge}>FORENSIC AI</div>
          <h1 style={{ ...S.title, letterSpacing: isMobile ? 3 : 6 }}>
            IMAGE{isMobile ? <br /> : " "}AUTHENTICATOR
          </h1>
          <p style={{ ...S.subtitle, fontSize: isMobile ? 12 : 13 }}>
            Upload or paste any image URL — our AI forensics engine determines if it's real or synthetic.
          </p>
        </header>

        {/* workspace */}
        <div style={{ display: "grid", gridTemplateColumns: two ? "1fr 1fr" : "1fr", gap: two ? 28 : 20, alignItems: "start" }}>

          {/* ── left panel ── */}
          <div style={S.panel}>
            {/* drop zone */}
            <div
              style={{ ...S.dropZone, ...(dragOver ? S.dropZoneActive : {}), ...(image ? S.dropZoneHasImage : {}), minHeight: isMobile ? 160 : 200 }}
              onClick={() => !image && fileRef.current.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f); }}
            >
              {image ? (
                <div style={{ width: "100%", position: "relative" }}>
                  {image.mode === "url" ? (
                    <div style={S.urlCard}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>🔗</div>
                      <div style={S.urlCardLabel}>URL IMAGE READY</div>
                      <div style={S.urlCardSrc}>{image.meta?.url || image.urlDirect}</div>
                      <div style={S.urlCardNote}>Server fetches this directly — no CORS issues</div>
                    </div>
                  ) : (
                    <img src={image.src} alt="preview" style={S.previewImg} />
                  )}
                  <button
                    style={{ ...S.clearBtn, width: isMobile ? 36 : 28, height: isMobile ? 36 : 28, fontSize: isMobile ? 14 : 12 }}
                    onClick={(e) => { e.stopPropagation(); reset(); }}
                    aria-label="Remove image"
                  >✕</button>
                </div>
              ) : (
                <div style={S.dropInner}>
                  <div style={{ fontSize: isMobile ? 32 : 40, color: "#1e3040", marginBottom: 12 }}>⬡</div>
                  <div style={{ fontSize: isMobile ? 11 : 12, letterSpacing: 3, color: "#3a5060" }}>
                    {isMobile ? "TAP TO BROWSE" : "DROP IMAGE HERE"}
                  </div>
                  {!isMobile && <div style={{ fontSize: 10, color: "#1e3040", marginTop: 4 }}>or click to browse</div>}
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => loadFile(e.target.files[0])} />

            {/* divider */}
            <div style={S.divider}><span style={S.dividerLabel}>OR PASTE URL</span></div>

            {/* url row */}
            <div style={S.urlRow}>
              <input
                style={{ ...S.urlInput, fontSize: isMobile ? 11 : 12 }}
                placeholder="https://example.com/image.jpg"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadUrl()}
                inputMode="url" autoCapitalize="none" autoCorrect="off"
              />
              <button
                style={{ ...S.urlBtn, padding: isMobile ? "12px 16px" : "10px 18px", minWidth: isMobile ? 60 : "auto" }}
                onClick={loadUrl} disabled={loading || !urlInput.trim()}
              >LOAD</button>
            </div>

            {/* metadata */}
            {image?.meta && (
              <div style={S.metaBox}>
                <div style={S.metaTitle}>FILE METADATA</div>
                {Object.entries(image.meta).map(([k, v]) => (
                  <div key={k} style={S.metaRow}>
                    <span style={S.metaKey}>{k.replace(/_/g, " ").toUpperCase()}</span>
                    <span style={S.metaVal}>{v}</span>
                  </div>
                ))}
              </div>
            )}

            {/* error */}
            {error && <div style={S.errorBox} role="alert">{error}</div>}

            {/* analyse button */}
            {image && (
              <button
                style={{ ...S.analyzeBtn, ...(loading ? S.analyzeBtnDisabled : {}), fontSize: isMobile ? 11 : 12, padding: isMobile ? "16px 20px" : "14px 24px" }}
                onClick={analyze} disabled={loading}
              >
                {loading
                  ? <span style={S.loadingRow}><span style={S.spinner} /> ANALYSING…</span>
                  : "▶ RUN FORENSIC ANALYSIS"
                }
              </button>
            )}
          </div>

          {/* ── right panel ── */}
          <div style={{ ...S.resultsPanel, minHeight: two ? 420 : "auto" }}>
            {phase === "idle" && (
              <div style={S.centred}>
                <div style={{ fontSize: 44, color: "#1a2c38" }}>◈</div>
                <div style={S.stateLabel}>AWAITING INPUT</div>
                <div style={S.stateHint}>Upload or link an image to begin</div>
              </div>
            )}
            {phase === "uploaded" && (
              <div style={S.centred}>
                <div style={{ fontSize: 44, color: "#00ffcc44" }}>◉</div>
                <div style={{ ...S.stateLabel, color: "#a8ff78" }}>IMAGE LOADED</div>
                <div style={S.stateHint}>Tap "Run Forensic Analysis" to begin</div>
              </div>
            )}
            {phase === "analyzing" && (
              <div style={S.centred}>
                <div style={S.scanGrid}>
                  {["VISUAL ARTIFACTS","ANATOMY CHECK","TEXTURE SCAN","SCENE COHERENCE","FINE DETAILS","METADATA PARSE"].map((lbl, i) => (
                    <div key={lbl} style={{ ...S.scanItem, animationDelay: `${i * 0.25}s` }}>
                      <span style={S.scanDot} />{lbl}
                    </div>
                  ))}
                </div>
                <div style={S.scanLabel}>PROCESSING…</div>
              </div>
            )}
            {phase === "done" && result && (
              <div style={{ animation: "fadeUp 0.35s ease" }}>
                <div style={{
                  ...S.verdictBanner,
                  background: result.verdict === "YES" ? "linear-gradient(135deg,#c0392b,#e74c3c)" : "linear-gradient(135deg,#0f7c5a,#27ae60)",
                  padding: isMobile ? "16px" : "20px 24px",
                }}>
                  <div style={{ ...S.verdictLabel, fontSize: isMobile ? 18 : 22 }}>
                    {result.verdict === "YES" ? "⚠ AI GENERATED" : "✓ LIKELY AUTHENTIC"}
                  </div>
                  <div style={S.confRow}>
                    <span style={S.confLabel}>CONFIDENCE</span>
                    <div style={S.confTrack}>
                      <div style={{ ...S.confFill, width: `${result.confidence}%`, background: result.verdict === "YES" ? "#e74c3c" : "#2ecc71" }} />
                    </div>
                    <span style={S.confValue}>{result.confidence}%</span>
                  </div>
                </div>
                <div style={{ ...S.summaryBox, padding: isMobile ? "12px 16px" : "16px 24px" }}>
                  <p style={{ ...S.summaryText, fontSize: isMobile ? 12 : 13 }}>{result.summary}</p>
                </div>
                <div style={{ ...S.section, padding: isMobile ? "12px 16px" : "14px 24px" }}>
                  <div style={S.sectionTitle}>DETECTED INDICATORS</div>
                  {result.reasons?.map((r, i) => (
                    <div key={i} style={S.reasonRow}>
                      <span style={{ color: result.verdict === "YES" ? "#e74c3c" : "#2ecc71", flexShrink: 0 }}>◆</span>
                      <span style={{ ...S.reasonText, fontSize: isMobile ? 11 : 12 }}>{r}</span>
                    </div>
                  ))}
                </div>
                {result.indicators && (
                  <div style={{ ...S.section, padding: isMobile ? "12px 16px" : "14px 24px" }}>
                    <div style={S.sectionTitle}>FORENSIC BREAKDOWN</div>
                    {Object.entries(result.indicators).map(([k, v]) => (
                      <div key={k} style={{ ...S.indRow, flexDirection: isMobile ? "column" : "row", gap: isMobile ? 2 : 12 }}>
                        <div style={S.indKey}>{k.replace(/_/g, " ").toUpperCase()}</div>
                        <div style={{ ...S.indVal, textAlign: isMobile ? "left" : "right" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  style={{ ...S.resetBtn, margin: isMobile ? "12px 16px 16px" : "14px 24px 20px", padding: isMobile ? "12px 18px" : "10px 20px" }}
                  onClick={reset}
                >ANALYSE ANOTHER IMAGE</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── styles ──────────────────────────────────────────────── */
const S = {
  root: { minHeight: "100vh", background: "#080c10", fontFamily: "'Space Mono', monospace", color: "#c8d8e8", position: "relative", WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale" },
  scanlines: { position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, background: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,200,.012) 2px,rgba(0,255,200,.012) 4px)" },
  container: { position: "relative", zIndex: 1, maxWidth: 1120, margin: "0 auto" },
  header: { textAlign: "center" },
  badge: { display: "inline-block", fontSize: 10, letterSpacing: 4, color: "#00ffcc", border: "1px solid #00ffcc33", padding: "4px 14px", marginBottom: 14 },
  title: { fontFamily: "'Rajdhani', sans-serif", fontSize: "clamp(28px, 7vw, 60px)", fontWeight: 700, color: "#e8f4f8", animation: "glow 4s ease-in-out infinite", marginBottom: 10, lineHeight: 1.15 },
  subtitle: { color: "#607888", letterSpacing: 0.5, lineHeight: 1.75, maxWidth: 480, margin: "0 auto" },
  panel: { display: "flex", flexDirection: "column", gap: 14 },
  dropZone: { border: "2px dashed #1e3040", background: "#0a1018", cursor: "pointer", transition: "border-color .2s, background .2s", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", userSelect: "none", WebkitTapHighlightColor: "transparent" },
  dropZoneActive: { borderColor: "#00ffcc", background: "#081a18" },
  dropZoneHasImage: { borderStyle: "solid", cursor: "default" },
  dropInner: { textAlign: "center", padding: "28px 20px" },
  previewImg: { width: "100%", display: "block", maxHeight: 300, objectFit: "contain" },
  clearBtn: { position: "absolute", top: 8, right: 8, background: "#c0392b", border: "none", color: "#fff", cursor: "pointer", fontFamily: "'Space Mono', monospace", display: "flex", alignItems: "center", justifyContent: "center", touchAction: "manipulation" },
  urlCard: { padding: "24px 16px", textAlign: "center", background: "#0a1420" },
  urlCardLabel: { fontSize: 9, letterSpacing: 3, color: "#00ffcc", marginBottom: 8 },
  urlCardSrc: { fontSize: 10, color: "#3a6070", wordBreak: "break-all", padding: "6px 10px", background: "#060e14", margin: "0 0 6px" },
  urlCardNote: { fontSize: 10, color: "#2a3c4a", fontStyle: "italic" },
  divider: { display: "flex", alignItems: "center", gap: 10 },
  dividerLabel: { fontSize: 9, letterSpacing: 3, color: "#1e3040", whiteSpace: "nowrap" },
  urlRow: { display: "flex", gap: 8 },
  urlInput: { flex: 1, background: "#0a1018", border: "1px solid #1e3040", color: "#c8d8e8", padding: "12px 14px", fontFamily: "'Space Mono', monospace", outline: "none", WebkitAppearance: "none", borderRadius: 0 },
  urlBtn: { background: "transparent", border: "1px solid #00ffcc44", color: "#00ffcc", cursor: "pointer", fontSize: 10, letterSpacing: 2, fontFamily: "'Space Mono', monospace", transition: "all .15s", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" },
  metaBox: { background: "#0a1018", border: "1px solid #192830", padding: "12px 14px" },
  metaTitle: { fontSize: 8, letterSpacing: 3, color: "#00ffcc66", marginBottom: 8 },
  metaRow: { display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4, flexWrap: "wrap" },
  metaKey: { fontSize: 9, color: "#3a5868", letterSpacing: 1 },
  metaVal: { fontSize: 9, color: "#6a8898", maxWidth: 200, textAlign: "right", wordBreak: "break-all" },
  errorBox: { background: "#1a0808", border: "1px solid #c0392b66", color: "#e88070", padding: "10px 14px", fontSize: 11, lineHeight: 1.6 },
  analyzeBtn: { background: "linear-gradient(135deg,#00a8cc,#00ffcc)", border: "none", color: "#080c10", letterSpacing: 3, fontFamily: "'Space Mono', monospace", fontWeight: 700, cursor: "pointer", transition: "opacity .2s", width: "100%", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" },
  analyzeBtnDisabled: { opacity: 0.65, cursor: "not-allowed" },
  loadingRow: { display: "flex", alignItems: "center", gap: 10, justifyContent: "center" },
  spinner: { display: "inline-block", width: 13, height: 13, border: "2px solid #08101866", borderTop: "2px solid #080c10", borderRadius: "50%", animation: "spin .65s linear infinite" },
  resultsPanel: { background: "#0d1318", border: "1px solid #1a2b38", display: "flex", flexDirection: "column" },
  centred: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px", gap: 10 },
  stateLabel: { fontSize: 11, letterSpacing: 4, color: "#2a4050" },
  stateHint: { fontSize: 10, color: "#1a2e3a", textAlign: "center", lineHeight: 1.7 },
  scanGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px", marginBottom: 20 },
  scanItem: { fontSize: 9, letterSpacing: 2, color: "#3a5868", display: "flex", alignItems: "center", gap: 7, animation: "pulse 1.5s ease-in-out infinite" },
  scanDot: { display: "inline-block", width: 5, height: 5, background: "#00ffcc", borderRadius: "50%", flexShrink: 0 },
  scanLabel: { fontSize: 10, letterSpacing: 4, color: "#00ffcc66", animation: "pulse 1s ease-in-out infinite" },
  verdictBanner: {},
  verdictLabel: { fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, letterSpacing: 3, color: "#fff", marginBottom: 10 },
  confRow: { display: "flex", alignItems: "center", gap: 8 },
  confLabel: { fontSize: 8, letterSpacing: 2, color: "rgba(255,255,255,.7)", whiteSpace: "nowrap" },
  confTrack: { flex: 1, height: 3, background: "rgba(0,0,0,.35)" },
  confFill: { height: "100%", transition: "width .8s ease" },
  confValue: { fontSize: 10, color: "#fff", minWidth: 32, textAlign: "right" },
  summaryBox: { borderBottom: "1px solid #1a2b38", background: "#0a1318" },
  summaryText: { lineHeight: 1.75, color: "#b8ccd8" },
  section: { borderBottom: "1px solid #1a2b38" },
  sectionTitle: { fontSize: 8, letterSpacing: 3, color: "#00ffcc66", marginBottom: 10 },
  reasonRow: { display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 7 },
  reasonText: { color: "#90a8b8", lineHeight: 1.65 },
  indRow: { display: "flex", justifyContent: "space-between", marginBottom: 7, flexWrap: "wrap" },
  indKey: { fontSize: 8, letterSpacing: 2, color: "#3a5060", whiteSpace: "nowrap" },
  indVal: { fontSize: 10, color: "#7090a0", flex: 1 },
  resetBtn: { background: "transparent", border: "1px solid #1a2b38", color: "#3a5868", cursor: "pointer", fontSize: 9, letterSpacing: 3, fontFamily: "'Space Mono', monospace", transition: "all .2s", alignSelf: "flex-start", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" },
};
