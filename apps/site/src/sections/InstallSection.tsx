const REPO = "https://github.com/Fausto95/react-lens";
const DOCS = `${REPO}/blob/main/docs`;

interface Path {
  title: string;
  body: string;
  cmd?: string;
  href: string;
  linkLabel: string;
}

const PATHS: Path[] = [
  {
    title: "Playground",
    body: "No extension. A demo app engineered to misbehave, with the panel mounted in-page.",
    cmd: "pnpm dev:playground",
    href: `${DOCS}/getting-started.md`,
    linkLabel: "Full guide",
  },
  {
    title: "Chrome extension",
    body: "Build, then load apps/extension/dist as unpacked. Open DevTools → React Lens on any React 19 app.",
    cmd: "pnpm build:extension",
    href: `${DOCS}/getting-started.md`,
    linkLabel: "Install steps",
  },
  {
    title: "This site",
    body: "You’re already in it — the panel on the right is this page’s real tree. Run locally with pnpm dev:site.",
    cmd: "pnpm dev:site",
    href: "https://www.reactlens.xyz/",
    linkLabel: "reactlens.xyz",
  },
];

export function InstallSection() {
  return (
    <section id="install">
      <div className="sec-kicker">
        <span className="dot" /> Install
      </div>
      <h2>Try it three ways.</h2>
      <p className="sec-lead">
        Clone the repo (Node ≥ 20, pnpm). Packages are not on npm yet — run from source. Details in{" "}
        <a href={`${DOCS}/getting-started.md`} target="_blank" rel="noreferrer">
          getting started
        </a>
        .
      </p>
      <div className="feats">
        {PATHS.map((p) => (
          <article className="feat" key={p.title}>
            <h3>{p.title}</h3>
            <p>{p.body}</p>
            {p.cmd ? <pre className="code">{p.cmd}</pre> : null}
            <p>
              <a href={p.href} target="_blank" rel="noreferrer">
                {p.linkLabel} ↗
              </a>
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
