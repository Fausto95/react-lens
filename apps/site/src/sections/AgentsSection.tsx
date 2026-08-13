const REPO = "https://github.com/Fausto95/react-lens";
const DOCS = `${REPO}/blob/main/docs`;

interface Card {
  title: string;
  body: string;
  cmd: string;
  href: string;
  linkLabel: string;
}

const CARDS: Card[] = [
  {
    title: "Analyze",
    body: "Turn an exported session into a markdown report — summary, waste, slowness — without opening the panel.",
    cmd: "react-lens analyze session.json",
    href: `${DOCS}/cli.md`,
    linkLabel: "CLI docs",
  },
  {
    title: "MCP",
    body: "Stdio server over a session file. Same 22 typed tools as the in-panel agent — every answer cites a Lens ID.",
    cmd: "react-lens mcp --session session.json",
    href: `${DOCS}/mcp.md`,
    linkLabel: "MCP docs",
  },
  {
    title: "Verify in CI",
    body: "Name interactions in Playwright, capture sessions, compare baseline vs actual — or let an agent call compare_sessions.",
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
      <div className="feats">
        {CARDS.map((c) => (
          <article className="feat" key={c.title}>
            <h3>{c.title}</h3>
            <p>{c.body}</p>
            <pre className="code">{c.cmd}</pre>
            <p>
              <a href={c.href} target="_blank" rel="noreferrer">
                {c.linkLabel} ↗
              </a>
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
