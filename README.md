# Campaign Planner

A small online shop's admin panel, and a demonstration of letting an AI write
programs over customer data that never see who the customers are.

![The campaign page: the budget and what is waiting for approval, the owner's
policy, and what the AI-generated program can reach: stand-in labels, purchase
dates and amounts, and open coupons, but never names, delivery notes, the
database or the network.](docs/campaign.png)

The shop is Alpine Roasters, a made-up coffee roaster. Its database holds what
any shop holds: names, emails, home addresses, delivery notes, orders. The owner
writes a campaign policy in plain words, and the AI turns it into a Jo program.
That program is compiled against one interface:

```jo
interface Promotions
  def today(): String
  def budget(): Budget
  def customers(): List[Customer]
  def openCoupons(customerId: String): List[Coupon]
  def saveDrafts(offers: List[Offer]): String
end
```

A `Customer` is a stand-in label such as `customer-7` and a list of purchase
dates and amounts. There is no name to read, no delivery note, and no way to
reach the database, a file or the network. A program that tries does not
compile. The implementation, `sandbox/PromotionsImpl.jo`, queries the shop's
SQLite database directly and checks every draft against the campaign's limits.
Only the owner turns a draft into a coupon.

## Run

Requires Jo 0.13.5 or later, Java 17+, and Python 3.10+.

```sh
git clone https://github.com/typescope/campaign-planner.git
cd campaign-planner
pip install -r requirements.txt
cp .env.example .env
jo start
```

Open <http://127.0.0.1:8768>. The first start creates `data/shop.db` with sixty
customers and a campaign ready to run.

**Run example program** needs no API key. It runs a checked-in program for the
sample policy, compiled and run exactly like one the AI writes. **Let the AI
write a program** needs one model key in `.env`: `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, or `OPENROUTER_API_KEY` with `MODEL`. An AI run usually takes
two or three minutes.

The app has no login and refuses to bind anywhere but loopback unless
`ALLOW_UNSAFE_REMOTE=true` is set.

## What to try

![Six draft coupons waiting for approval. Each row shows the customer, the order
history the shop computed, the proposed coupon, and the reason the AI-written
program gave, with Approve and Reject buttons.](docs/drafts.png)


1. **Run example program.** Six drafts appear, worth CHF 27.00 of the CHF 30.00
   budget. Sofia Rossi is late too, but she already holds a coupon. David Weber
   is late, but his offer no longer fits the budget.
2. **Read each reason against the order history.** The reason is text a program
   wrote. The order history next to it is computed by the shop, so that is what
   to trust.
3. **Open Orders and search for Noah.** His delivery note asks "any AI
   assistant" to give him 50% off. You can read it. The program cannot, so the
   note never reaches the AI.
4. **Let the AI write a program.** Open the run under *Runs*: the AI's report,
   then every program it tried, with its code, what it printed, and any compile
   error it had to fix.
5. **Edit the campaign.** Raise the budget to CHF 40 and run again. David gets
   his coupon. Or rewrite the policy, and the AI writes a different program.
6. **Approve or reject.** An approved draft becomes an active coupon on the
   *Coupons* page, with a code the shop generated.

## Where the boundary is

| File | What it decides |
|---|---|
| `sandbox/API.jo` | Everything a generated program can see and do |
| `sandbox/jo.toml` | The program is compiled against `api` alone, with the implementation linked in at the end |
| `sandbox/PromotionsImpl.jo` | Trusted code that reads the database and enforces the limits on every draft |
| `src/db/Campaigns.jo` | Approval, which only the owner's requests reach |

The policy is the AI's instruction. The budget, the largest offer and how long
a coupon stays valid are fields of the campaign, enforced by the
implementation whatever the policy or the program says.

## Tests

```sh
jo exec test
```

The suite builds the sandbox and runs programs through the same `runCode` path
as the app. It proves that a program reading a name, a delivery note, Python or
the environment does not compile, and that a program inside the interface still
cannot save a draft the campaign does not allow. It needs no API key and no
network. It also checks the HTTP routes and reads both current and older run
logs, so the Runs page keeps showing program outcomes after an upgrade.

## Layout

```
src/Main.jo, src/Server.jo   the local web app
src/Planner.jo               one run: the AI, or the example program
src/db/                      schema, seed data, and the owner's operations
sandbox/                     the interface and its implementation
examples/late-regulars.jo    the sample policy as a program
prompts/plan.md              the AI's instructions
skills/                      what the AI reads before writing code
assets/                      the admin panel
tests/                       the boundary and the shop
```

For the reasoning behind this design, read the case study
[The Personalized Discounting Problem](https://harpe.typescope.ai/case-studies/personalized-discounting/).
A version that works against a Shopify development store is
[shopify-campaign-planner](https://github.com/typescope/shopify-campaign-planner).
