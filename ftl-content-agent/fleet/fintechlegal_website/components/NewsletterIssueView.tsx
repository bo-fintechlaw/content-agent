type Stat = { value: string; label: string };
type Deadline = { date: string; requirement: string };
type ActionGroup = { firm_type: string; label?: string; items: string[] };

type Panel =
  | {
      kind: 'feature';
      kicker: string;
      headline: string;
      dek: string;
      hero_image_url?: string;
      stats?: Stat[];
      action_list: string[];
      pull_quote: string;
      blog_url: string;
    }
  | {
      kind: 'compliance_corner';
      kicker: string;
      headline: string;
      dek: string;
      deadlines?: Deadline[];
      litigation_watch?: string[];
    }
  | {
      kind: 'action_items';
      kicker: string;
      headline: string;
      dek: string;
      groups: ActionGroup[];
      consultation_url: string;
    }
  | {
      kind: 'spotlight';
      kicker: string;
      headline: string;
      dek: string;
      body: string;
    };

export type NewsletterIssue = {
  title: string;
  issue_date: string;
  intro: string;
  toc: string[];
  panels: Panel[];
  author: { name: string; title: string };
  footer: { disclaimer: string; physical_address: string; subscribe_url?: string };
};

const LOGO = 'https://fintechlaw.ai/apple-touch-icon.png';

function sectionLabel(kind: Panel['kind']) {
  if (kind === 'feature') return 'FROM THE BLOG';
  if (kind === 'compliance_corner') return 'COMPLIANCE CORNER';
  if (kind === 'action_items') return 'YOUR MOVE';
  return 'SPOTLIGHT';
}

function formatDate(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function NewsletterIssueView({ issue }: { issue: NewsletterIssue }) {
  const dateStr = formatDate(issue.issue_date);

  return (
    <article className="mx-auto max-w-3xl bg-white text-[#191919]">
      <header className="flex items-center gap-4 bg-gradient-to-br from-[#4d539c] to-[#3f447c] px-6 py-6 text-white">
        <img src={LOGO} alt="FinTech Law" width={48} height={48} className="rounded-lg" />
        <div>
          <p className="m-0 text-xs uppercase tracking-widest opacity-90">{issue.title}</p>
          <p className="mt-1 text-sm opacity-75">{dateStr}</p>
        </div>
      </header>

      <section className="px-6 py-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#d71566]">
          From {issue.author.name}
        </p>
        <p className="m-0 text-lg leading-relaxed">{issue.intro}</p>
      </section>

      <nav className="border-b border-[#cfd0de] px-6 pb-6">
        <p className="mb-3 text-[0.7rem] font-semibold uppercase tracking-widest text-[#6f739d]">
          In This Edition
        </p>
        <ul className="m-0 list-disc pl-5">
          {issue.toc.map((item) => (
            <li key={item} className="mb-1">
              {item}
            </li>
          ))}
        </ul>
      </nav>

      {issue.panels.map((panel, idx) => (
        <PanelBlock key={`${panel.kind}-${idx}`} panel={panel} />
      ))}

      <footer className="border-t border-[#cfd0de] bg-[#ebecf2] px-6 py-6 text-sm text-[#6f739d]">
        <p>{issue.footer.disclaimer}</p>
        <p>{issue.footer.physical_address}</p>
        <p className="mt-4 text-[#191919]">
          — {issue.author.name}, {issue.author.title}
        </p>
      </footer>
    </article>
  );
}

function PanelBlock({ panel }: { panel: Panel }) {
  const section = sectionLabel(panel.kind);
  const compliance = panel.kind === 'compliance_corner';

  return (
    <section
      className={`border-b border-[#cfd0de] px-6 py-8 ${compliance ? 'bg-[#ebecf2]' : ''}`}
    >
      <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-widest text-[#4d539c]">
        {section}
      </p>
      <p className="mb-2 text-[0.7rem] uppercase tracking-wide text-[#6f739d]">{panel.kicker}</p>
      <h2 className="mb-2 font-serif text-3xl font-normal leading-tight">{panel.headline}</h2>
      <p className="mb-4 text-lg text-[#6f739d]">{panel.dek}</p>

      {panel.kind === 'feature' && (
        <>
          {panel.hero_image_url ? (
            <img
              src={panel.hero_image_url}
              alt=""
              className="mb-4 block w-full rounded object-cover"
              loading="lazy"
            />
          ) : null}
          {panel.stats?.length ? (
            <div className="mb-4 flex flex-wrap gap-3">
              {panel.stats.map((s) => (
                <div
                  key={`${s.value}-${s.label}`}
                  className="min-w-[120px] flex-1 border border-[#cfd0de] bg-[#ebecf2] px-4 py-3 text-center"
                >
                  <p className="m-0 font-serif text-2xl text-[#4d539c]">{s.value}</p>
                  <p className="mt-1 text-[0.65rem] uppercase tracking-wide text-[#6f739d]">
                    {s.label}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          {panel.action_list?.length ? (
            <>
              <p className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-[#d71566]">
                Key takeaways
              </p>
              <ul className="mb-4 list-disc pl-5">
                {panel.action_list.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
          {panel.pull_quote ? (
            <div className="mb-4 border-l-4 border-[#d71566] bg-[#ebecf2] px-4 py-3 italic">
              <p className="mb-1 text-[0.65rem] font-semibold uppercase not-italic tracking-wide text-[#6f739d]">
                Why it matters
              </p>
              <p className="m-0">&ldquo;{panel.pull_quote}&rdquo;</p>
            </div>
          ) : null}
          <a
            href={panel.blog_url}
            className="inline-block rounded bg-[#4d539c] px-4 py-2.5 text-sm font-semibold text-white no-underline"
          >
            Read the full analysis →
          </a>
        </>
      )}

      {panel.kind === 'compliance_corner' && (
        <>
          {panel.deadlines?.length ? (
            <>
              <p className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-[#d71566]">
                Deadlines
              </p>
              <table className="mb-4 w-full border-collapse">
                <tbody>
                  {panel.deadlines.map((d) => (
                    <tr key={`${d.date}-${d.requirement}`}>
                      <td className="py-2 pr-4 align-top font-semibold text-[#4d539c] whitespace-nowrap">
                        {d.date}
                      </td>
                      <td className="py-2 align-top">{d.requirement}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          {panel.litigation_watch?.length ? (
            <>
              <p className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-[#d71566]">
                Litigation watch
              </p>
              <ul className="list-disc pl-5">
                {panel.litigation_watch.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}

      {panel.kind === 'action_items' && (
        <>
          {panel.groups.map((g) => (
            <div key={g.firm_type} className="mt-4">
              <p className="mb-2 font-semibold text-[#4d539c]">
                {g.label ? `${g.label} · ` : ''}
                {g.firm_type}
              </p>
              <ul className="list-disc pl-5">
                {g.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
          <p className="mt-4">
            <a href={panel.consultation_url} className="font-semibold text-[#4d539c]">
              Schedule a consultation →
            </a>
          </p>
        </>
      )}

      {panel.kind === 'spotlight' && <div className="whitespace-pre-wrap">{panel.body}</div>}
    </section>
  );
}
