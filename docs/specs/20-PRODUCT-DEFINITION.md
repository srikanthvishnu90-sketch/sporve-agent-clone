# 20 — PRODUCT DEFINITION
The document every other document answers to. If something contradicts this, this wins.
## 20.1 What Sporv is
**Sporv is B2B SaaS for the people who run youth sports.** An AI agent connected to the org's email, payments, and calendar that does the administrative work a human currently does by hand, and a web application where that person reviews and approves it. Mission: **make coaching the priority.** Every hour Sporv removes from admin is an hour returned to coaching. That is the product's only reason to exist and the test every feature is measured against.
## 20.2 Who it is for
| Customer | Scale | What hurts most |
|---|---|---|
| **Private trainer** | 1 person, 10–60 clients | Finding clients, chasing payment, booking gym space, answering everything alone |
| **Team or small program** | 1–5 staff, 1–4 teams | Scheduling, parent communication, dues, waivers |
| **Club or organization** | 5–50 staff, many teams | All of the above plus staff compliance, multi-team scheduling, financial oversight |
The trainer is not a lesser case of the club. A trainer needs client acquisition and facility sourcing that a club rarely does. A club needs roles and compliance a trainer never does. The product serves both without forcing either into the other's shape.
**Reference customer (Sep 2026):** one signed coach, currently on Sprocket. Named needs: gym finding, email responding, payments, employee management. Their week is the specification. When this document and that coach disagree, the coach wins.
## 20.3 The thesis
**Everything the incumbents do, simpler, done by the agent instead of by a human.** TeamSnap, Sprocket, SportsEngine and Sports Connect are systems of record. They store information and then make a person do all the work. Sporv stores the same information and **does the work.** Where a competitor ships a screen, Sporv ships an agent that removes the need to open it.
## 20.4 What is in and what is out
A feature is IN when either: an org cannot run a season without it, or the incumbent makes a human do it manually and the agent can do it instead. A feature is OUT when the work is families talking to families (team chat, photo sharing, parent community). Parity built later, agent-first: league scheduling with constraint solving, brackets and standings, a public site generated from org data.
## 20.5 Hard architectural facts
**Staff-only software.** Everyone who logs in is staff: owner, director, treasurer, registrar, coach. Account required, session required, enforced in RLS server-side, never in the client. There is no unauthenticated route that touches org data, money, or athlete records.
**Parents never log in.** No account, no dashboard, no app, no signup. Reached by SMS, email, and a calendar feed. The only exception is a one-time, scoped, expiring link to complete a single action. This is the commercial wedge: families download nothing.
**One web surface.** An installable PWA. No native app.
**Draft-first, always.** The agent notices, researches, and drafts. It never sends, charges, or publishes. One human click per action, enforced by database triggers rather than convention.
**The marketplace is dead.** The schema still carries its nouns (`providers`, `bookings`) — accepted naming debt — but no marketplace concept is built, extended, or reasoned from.
## 20.6 Infrastructure
Repo: srikanthvishnu90-sketch/sporve-agent-clone · Vercel · Supabase · Stripe + Connect · Resend (tx./msg./reply.) · Twilio (A2P 10DLC pending) · Anthropic generation · OpenAI text-embedding-3-large @1024 · Google Places · Background checks: vendor-agnostic interface, self-serve sandbox now, NCSI later · Sentry · BetterStack.
Other repos: sporve-web is marketing; sporve-marketplace is the dead consumer product; everything else is archive.
## 20.7 State of play
One signed coach. Zero orgs live. No payment ever processed end to end. No message ever delivered to a human. Scheduling, the parent channel, and registration are green-field. **Launch-ready means one real organization ran one real season on Sporv and the founder never touched the database.**
