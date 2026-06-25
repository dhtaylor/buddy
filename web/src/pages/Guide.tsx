import { Link } from 'react-router-dom';

// In-app getting-started guide. Reachable from the household bar ("Help") and the
// first-run welcome screen. Plain-language, mirrors the real setup flow so a new
// household admin can follow it top to bottom.
export default function Guide() {
  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h1 className="text-2xl font-bold">Getting started</h1>
        <p className="mt-1 text-gray-600">
          Buddy is a shared budget for your household — a ledger, a weekly budget, bills, and bank
          imports, all in one place. This walks you through setting it up the first time.
        </p>
      </div>

      <Card title="Set up your household" subtitle="Do this once, in order.">
        <Step n={1} title="Create the admin account">
          On the login screen, choose <Em>“First-time setup? Create the admin account.”</Em> Enter
          your name, a <Em>household name</Em> (e.g. “The Taylors”), your email, and a password. This
          first account is the household admin. If you instead see “Registration is closed,” ask your
          admin to add you from their <NavTo>Settings → Add spouse / partner</NavTo>.
        </Step>

        <Step n={2} title="Pick your budget period">
          Go to <NavTo>Settings → Household</NavTo> and set your <Em>budget period</Em> — weekly,
          biweekly, monthly, or a custom number of days. The <Em>anchor date</Em> tells Buddy where
          one period ends and the next begins (e.g. set it to a payday). Everything on Home, Budget,
          and History is grouped by this period, so it’s worth getting right up front. Press{' '}
          <Em>Save household.</Em>
        </Step>

        <Step n={3} title="Add your accounts & opening balances">
          In <NavTo>Settings → Accounts &amp; opening balances</NavTo>, add each account you want to
          track — checking, savings, or cash — with its current balance as the{' '}
          <Em>opening balance</Em>. Your running balance on Home starts from these numbers, so enter
          today’s real balances. Have a line of credit? Add a <Em>HELOC / Line of credit</Em> account
          and see the <Link to="/guide#heloc" className="text-brand underline">HELOC view</Link> note
          below.
        </Step>

        <Step n={4} title="Review your categories">
          Buddy seeds a starter set of categories (Groceries, Utilities, Cars, and so on) when the
          household is created. In <NavTo>Settings → Categories</NavTo> you can add your own, mark a
          category as <Em>income</Em> vs. expense, or <Em>Hide</Em> ones you don’t use. Hiding keeps
          past transactions and History intact — it just clears the clutter off the Budget page.
        </Step>

        <Step n={5} title="Invite your spouse or partner" last>
          In <NavTo>Settings → Add spouse / partner</NavTo>, enter their name, email, and a temporary
          password. They can log in right away and share the same household — same accounts, budget,
          and bills. They can change their password later.
        </Step>
      </Card>

      <Card title="Using Buddy day to day">
        <Tour icon="🏠" label="Home">
          Your running balance and a quick summary of income vs. spending for the current period.
          Step between periods with <Em>Prev</Em> / <Em>Next</Em>.
        </Tour>
        <Tour icon="📒" label="Ledger">
          The list of every transaction. Add income and expenses here, assign a category, and mark
          items cleared once they hit your bank.
        </Tour>
        <Tour icon="📊" label="Budget">
          Plan how much each category gets per period, then watch planned vs. actual fill in as you
          spend.
        </Tour>
        <Tour icon="🧾" label="Bills">
          Track recurring bills so nothing slips through the cracks.
        </Tour>
        <Tour icon="📥" label="Import">
          Download a CSV or OFX file from your bank and upload it — Buddy matches each row against
          your ledger so you can reconcile in a couple of taps instead of typing everything by hand.
        </Tour>
        <Tour icon="📈" label="History" last>
          Trends across past periods — where the money actually went over time.
        </Tour>
      </Card>

      <Card title="Optional: HELOC cash-sweep view" id="heloc">
        <p className="text-sm text-gray-600">
          If you’re running a line of credit (velocity banking), Buddy can turn Home into a cash-vs-debt
          view with a paydown card and an “interest saved” number. Turn it on under{' '}
          <NavTo>Settings → Household</NavTo> after adding a <Em>HELOC / Line of credit</Em> account.
          It only changes how things are displayed — it never alters your data. Full walkthrough is in{' '}
          <Em>docs/heloc.md</Em>.
        </p>
      </Card>

      <Link to="/settings" className="btn-primary text-center">
        Go to Settings
      </Link>
    </div>
  );
}

function Card({
  title,
  subtitle,
  id,
  children,
}: {
  title: string;
  subtitle?: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="card flex flex-col gap-3 scroll-mt-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Step({
  n,
  title,
  children,
  last,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`flex gap-3 ${last ? '' : 'border-b border-gray-100 pb-3'}`}>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
        {n}
      </div>
      <div className="text-sm text-gray-600">
        <div className="font-semibold text-gray-800">{title}</div>
        <p className="mt-0.5">{children}</p>
      </div>
    </div>
  );
}

function Tour({
  icon,
  label,
  children,
  last,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`flex gap-3 ${last ? '' : 'border-b border-gray-100 pb-3'}`}>
      <span className="text-lg leading-none">{icon}</span>
      <p className="text-sm text-gray-600">
        <span className="font-semibold text-gray-800">{label} — </span>
        {children}
      </p>
    </div>
  );
}

function Em({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-gray-800">{children}</span>;
}

// Names an in-app location the user should navigate to.
function NavTo({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-gray-800">{children}</span>;
}
