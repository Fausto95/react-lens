const REPO = "https://github.com/Fausto95/react-lens";
const DOCS = `${REPO}/blob/main/docs`;

interface Row {
  title: string;
  body: string;
  cmd: string;
  href: string;
  linkLabel: string;
}

const ROWS: Row[] = [
  {
    title: "Analyze",
    body: "Turn an exported session into a markdown report — summary, waste, slowness — without opening the panel.",
    cmd: "react-lens analyze session.json",
    href: `${DOCS}/cli.md`,
    linkLabel: "CLI docs",
  },
  {
    title: "MCP",
    body: "Stdio server over a session file. Same 23 typed tools as the in-panel agent — answers cite Lens IDs.",
    cmd: "react-lens mcp --session session.json",
    href: `${DOCS}/mcp.md`,
    linkLabel: "MCP docs",
  },
  {
    title: "Verify in CI",
    body: "Name interactions in Playwright, export sessions, then compare baseline vs actual — or pass both payloads to compare_sessions.",
    cmd: "react-lens ci --baseline ./b --actual ./a",
    href: `${DOCS}/verify.md`,
    linkLabel: "Verify loop",
  },
];

export function AgentsSection() {
  return (
    <section id="agents">
      <div className="sec-kicker">
        <span className="dot" /> Agents · CLI · CI
      </div>
      <h2>Human or AI agent — same receipts.</h2>
      <p className="sec-lead">
        Export a session from the panel, then analyze it headlessly, hand it to an MCP host, or gate
        regressions in CI. The tools are the ones ⌘I already uses.
      </p>
      <div className="cmd-list">
        {ROWS.map((r) => (
          <article className="cmd-row" key={r.title}>
            <div className="cmd-row-head">
              <h3>{r.title}</h3>
              <a href={r.href} target="_blank" rel="noreferrer">
                {r.linkLabel} ↗
              </a>
            </div>
            <p>{r.body}</p>
            <pre className="code">{r.cmd}</pre>
          </article>
        ))}
      </div>
    </section>
  );
}
