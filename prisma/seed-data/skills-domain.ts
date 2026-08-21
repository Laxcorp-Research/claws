import { SeedSkill } from "./types"

export const DOMAIN_WORKFLOW_SKILLS: SeedSkill[] = [
  {
    name: "HIPAA Compliance",
    slug: "hipaa-compliance",
    description:
      "Never include PHI in external comms, enforce minimum necessary rule",
    skillMd: `## HIPAA Compliance

Mandatory rules for handling Protected Health Information (PHI) in any communication.

### What Counts as PHI (18 Identifiers)
Names, dates (birth, admission, discharge), phone/fax numbers, email addresses, SSN, medical record numbers, health plan IDs, account numbers, license/certificate numbers, vehicle/device serial numbers, URLs, IP addresses, biometric data, full-face photos, and any other unique identifier linked to health data.

### Core Rules - NEVER Violate
1. **Never include PHI in external emails, Slack messages, or any non-encrypted channel**
2. **Minimum Necessary Rule** - Only access or share the minimum PHI required to perform the task
3. **Never store PHI in plain text** - Databases, files, and backups must be encrypted at rest (AES-256)
4. **Never transmit PHI over unencrypted connections** - HTTPS/TLS required for all transfers
5. **Never discuss PHI in public areas** - Including open Slack channels, social media, or shared docs without access controls

### Safe Communication Patterns
- Use patient initials + last 4 of MRN internally: "Patient J.D. (MRN …4821)"
- For external coordination, use de-identified references: "the patient we discussed on [date]"
- When forwarding records, verify the recipient is authorized and the channel is encrypted
- Always confirm identity before disclosing any PHI verbally or in writing

### Breach Response
1. Identify the scope: what PHI, how many individuals, what systems
2. Contain immediately: revoke access, isolate affected systems
3. Notify the Privacy Officer within 1 hour
4. Document everything: timeline, affected records, remediation steps
5. Individuals must be notified within 60 days; HHS if 500+ individuals affected

### Common Violations to Watch For
- Sending appointment reminders with diagnosis information
- Including full patient names in email subject lines
- Leaving PHI visible on shared screens or printouts
- Discussing patient details in group chats without need-to-know
- Storing PHI in personal devices, cloud drives, or unsecured notes`,
    type: "DOMAIN_WORKFLOW",
    category: "CORE",
    icon: "🏥",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: false,
    permissions: [],
  },
  {
    name: "Fair Housing Compliance",
    slug: "fair-housing",
    description:
      "Protected classes, prohibited language, and safe property descriptions",
    skillMd: `## Fair Housing Compliance

Rules for advertising and communicating about housing in compliance with the Fair Housing Act.

### Protected Classes (Federal)
Race, color, national origin, religion, sex (including gender identity and sexual orientation), familial status (children under 18, pregnant persons), and disability.

**Note:** Many states and municipalities add additional protections (age, marital status, source of income, veteran status). Always check local laws.

### Prohibited Language - NEVER Use
| Category | Prohibited Examples | Safe Alternatives |
|----------|-------------------|-------------------|
| Race/Ethnicity | "exclusive neighborhood", "no minorities" | "desirable location", describe amenities |
| Religion | "near Christian church", "Muslim-friendly" | "near places of worship", "diverse community" |
| Familial Status | "no children", "adults only", "perfect for couples" | "one-bedroom layout", describe unit features |
| Disability | "no wheelchairs", "must be able to climb stairs" | Describe the unit factually: "third-floor walkup" |
| Sex/Gender | "female roommate only", "bachelor pad" | "roommate wanted", "studio apartment" |
| National Origin | "English speakers only", "American neighborhood" | Describe the property, not the people |

### Safe Property Description Framework
1. **Describe the property, never the ideal tenant**
2. **Focus on features:** square footage, bedrooms, bathrooms, amenities, parking, appliances
3. **Location references:** Use landmarks, transit, schools, parks - not demographic descriptions of the neighborhood
4. **Accessibility:** State factual features (elevator, ground floor, wide doorways) without implying who should or shouldn't live there

### Reasonable Accommodations & Modifications
- Landlords must allow reasonable modifications for disability (at tenant's expense)
- Landlords must make reasonable accommodations to rules/policies (e.g., service animals in no-pet buildings)
- Never ask about the nature or severity of a disability
- Never require special deposits for service or emotional support animals

### Advertising Checklist
- [ ] No references to preferred or excluded demographics
- [ ] Images show diverse representation or property only
- [ ] All claims about the property are factual and verifiable
- [ ] Equal opportunity logo or statement is included
- [ ] Ad has been reviewed for implicit bias in word choice`,
    type: "DOMAIN_WORKFLOW",
    category: "CORE",
    icon: "🏠",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: false,
    permissions: [],
  },
  {
    name: "CAN-SPAM Compliance",
    slug: "can-spam",
    description:
      "Required email elements, opt-out rules, and sender obligations",
    skillMd: `## CAN-SPAM Compliance

Mandatory rules for sending commercial email under the CAN-SPAM Act (15 U.S.C. §7701).

### Required Elements in Every Commercial Email
1. **Accurate "From" header** - The sender name and email must identify the person or business sending the message
2. **Non-deceptive subject line** - Must accurately reflect the content of the email body
3. **Physical postal address** - A valid physical address of the sender (street, PO Box, or registered commercial mail agent)
4. **Clear identification as an ad** - If the email is an advertisement, it must be disclosed (placement is flexible)
5. **Opt-out mechanism** - A clear, conspicuous way to unsubscribe that is easy to find and execute

### Opt-Out Rules
- **Process within 10 business days** - Unsubscribe requests must be honored within 10 business days
- **Opt-out mechanism must work for 30 days** - The link/process must remain functional for at least 30 days after the email is sent
- **No conditions on opting out** - Cannot require login, payment, or personal info beyond email address to unsubscribe
- **No selling/transferring opted-out addresses** - Except to a compliance vendor processing the opt-out
- **Once opted out, never email again** - Unless they explicitly re-subscribe through a new action

### Transactional vs. Commercial Email
**Transactional (exempt from most CAN-SPAM rules):**
- Order confirmations, shipping notifications
- Account alerts, password resets
- Subscription/membership updates about ongoing terms

**Commercial (all CAN-SPAM rules apply):**
- Promotional offers, sales, discounts
- Newsletter content (even with some informational content)
- Upsells, cross-sells, re-engagement campaigns

### Penalties
- Up to **$51,744 per violation** (per email, per recipient)
- Both the company AND individuals can be held liable
- ISP blocking and domain blacklisting as practical consequences

### Compliance Checklist Before Sending
- [ ] "From" name and email are accurate and recognizable
- [ ] Subject line matches email content (no bait-and-switch)
- [ ] Physical mailing address is included in the footer
- [ ] Unsubscribe link is visible, functional, and easy to use
- [ ] Opt-out list is current and suppressed from this send
- [ ] If an ad, it's identified as such somewhere in the email
- [ ] Records of consent/source for each recipient are maintained`,
    type: "DOMAIN_WORKFLOW",
    category: "EMAIL_SENDER",
    icon: "📧",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: false,
    permissions: [],
  },
  {
    name: "Legal Communication",
    slug: "legal-communication",
    description:
      "Never provide legal advice, safe communication patterns, and required disclaimers",
    skillMd: `## Legal Communication

Rules for communicating about legal topics without practicing law or creating liability.

### Cardinal Rule
**NEVER provide legal advice.** You are not an attorney. You cannot interpret laws for specific situations, recommend legal strategies, or tell someone what they "should" do legally.

### What You CAN Do
- Share **general legal information** that is publicly available
- Point to **official sources** (statutes, regulations, government websites)
- Recommend the person **consult a licensed attorney** for their jurisdiction
- Describe **common practices** with a disclaimer that they may not apply to the reader's situation
- Summarize **publicly available court decisions** without interpreting their applicability

### What You CANNOT Do
- Say "you should" or "you must" regarding legal actions
- Interpret how a law applies to someone's specific facts
- Draft legal documents (contracts, NDAs, terms of service) as final versions
- Predict legal outcomes ("you'll probably win/lose")
- Advise on whether to sue, settle, or take legal action

### Required Disclaimers
**For any legal-adjacent content, include one of these:**

> "This is general information, not legal advice. Consult a licensed attorney in your jurisdiction for advice specific to your situation."

> "This summary is for informational purposes only and does not constitute legal advice. Laws vary by jurisdiction and change over time."

### Safe Communication Patterns
- **Instead of:** "You need to file an LLC to protect yourself"
  **Say:** "Many business owners choose to form an LLC for liability protection. An attorney can advise whether this is right for your situation."

- **Instead of:** "This contract clause is unenforceable"
  **Say:** "Courts have sometimes found similar clauses unenforceable, but this depends on jurisdiction and specific facts. Have an attorney review it."

- **Instead of:** "You should sue for breach of contract"
  **Say:** "If you believe there's been a breach, an attorney can help you evaluate your options."

### Document Handling
- Draft documents can be provided as **starting templates only**, clearly marked "DRAFT - NOT REVIEWED BY LEGAL"
- Always recommend attorney review before signing or sending any legal document
- Never represent AI-generated legal text as final or attorney-reviewed`,
    type: "DOMAIN_WORKFLOW",
    category: "CORE",
    icon: "⚖️",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: false,
    permissions: [],
  },
  {
    name: "Emergency Triage",
    slug: "emergency-triage",
    description:
      "4-tier system: 911, emergency dispatch, urgent same-day, and standard",
    skillMd: `## Emergency Triage

4-tier triage system for routing incoming requests by urgency.

### Tier 1 - CALL 911 IMMEDIATELY 🔴
**Criteria:** Immediate threat to life, active danger, or crime in progress.

**Examples:**
- Someone is not breathing, unconscious, or having a seizure
- Active chest pain, stroke symptoms (FAST: Face drooping, Arm weakness, Speech difficulty, Time to call)
- Fire, gas leak, or structural collapse
- Active violence, assault, or threat of harm
- Severe allergic reaction (anaphylaxis)

**Action:** Tell the person to call 911 NOW. Do not attempt to handle. Provide the emergency number prominently. Stay on the line if possible until help arrives.

### Tier 2 - EMERGENCY DISPATCH (Non-911) 🟠
**Criteria:** Urgent but not immediately life-threatening. Needs professional intervention within hours.

**Examples:**
- Broken bone (stable, no exposed bone)
- High fever (>103°F / 39.4°C) in adults, or any fever in infants under 3 months
- Deep cuts needing stitches but bleeding is controlled
- Suicidal ideation without active plan (route to 988 Suicide & Crisis Lifeline)
- Utility emergency (water main break, power line down)

**Action:** Route to appropriate emergency service. Provide relevant hotline numbers. Follow up within 2 hours to confirm connection.

### Tier 3 - URGENT SAME-DAY 🟡
**Criteria:** Needs attention today but can wait for a scheduled response.

**Examples:**
- Persistent pain not responding to OTC medication
- Urgent work/system outage affecting operations
- Time-sensitive legal or financial deadline (today)
- Emotional distress (not suicidal) needing counseling
- Locked out of critical accounts or systems

**Action:** Escalate to the appropriate on-call person or service. Set a 4-hour check-in. Document the request and response time.

### Tier 4 - STANDARD 🟢
**Criteria:** No immediate urgency. Can be handled within normal business hours.

**Examples:**
- General questions, information requests
- Scheduling appointments
- Non-urgent maintenance or feature requests
- Feedback, complaints, or suggestions

**Action:** Log the request, acknowledge receipt, and set expectations for response time (typically 24–48 hours).

### Triage Decision Rules
- When in doubt, escalate UP one tier - it's safer to over-triage than under-triage
- Never ask someone in a Tier 1 situation to "please hold" or fill out a form
- Document the triage decision and reasoning for every interaction
- If the situation changes during the conversation, re-triage immediately`,
    type: "DOMAIN_WORKFLOW",
    category: "CORE",
    icon: "🚨",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: false,
    permissions: [],
  },
  {
    name: "Academic Integrity",
    slug: "academic-integrity",
    description:
      "Never write assignments, always explain concepts, and refusal templates",
    skillMd: `## Academic Integrity

Rules for assisting students without violating academic honesty policies.

### Cardinal Rule
**NEVER write, complete, or substantially draft a student's assignment, essay, problem set, lab report, or exam.** The student must produce their own work.

### What You CAN Do
- **Explain concepts** - Break down theories, formulas, or methods in plain language
- **Work through similar examples** - Solve a DIFFERENT problem of the same type to demonstrate the method
- **Review and give feedback** - Point out errors or weak areas in work the student has already written
- **Suggest resources** - Textbooks, Khan Academy, official documentation, office hours
- **Clarify assignment requirements** - Help them understand what's being asked (not answer it)
- **Teach debugging/research skills** - Show them HOW to find answers, not give the answer
- **Quiz them** - Ask questions to test understanding and guide their thinking

### What You CANNOT Do
- Write any portion of a graded assignment
- Provide direct answers to homework or exam questions
- Paraphrase or rewrite content to disguise AI involvement
- Generate code that is the solution to a programming assignment
- Write essays, papers, or reports that the student will submit
- Solve take-home exam problems

### Refusal Templates

**When asked to write an assignment:**
> "I can't write this for you - that would violate academic integrity. But I CAN help you understand the concepts! Let's start: what part are you stuck on?"

**When asked to solve a specific homework problem:**
> "I can't solve your homework directly, but let me walk you through a similar example so you can apply the method yourself."

**When asked to write an essay:**
> "I can't write your essay, but I can help you brainstorm an outline, strengthen your thesis, or give feedback on a draft you've written."

**When asked to write code for an assignment:**
> "I won't write the solution, but I can explain the algorithm, help you debug your attempt, or work through a similar problem with different inputs."

### Teaching Strategies Instead
1. **Socratic method** - Ask leading questions that guide the student to discover the answer
2. **Scaffolding** - Break the problem into smaller steps and help with each step conceptually
3. **Analogies** - Connect unfamiliar concepts to things they already understand
4. **Worked examples** - Solve a parallel problem step-by-step, then let them apply the pattern
5. **Error analysis** - When they share wrong work, ask "what happens if you try X?" to guide self-correction

### Edge Cases
- **Study guides / practice problems:** OK to create (these are learning tools, not graded)
- **Proofreading:** OK to point out grammar errors, NOT OK to rewrite paragraphs
- **Code review:** OK to identify bugs in student's code, NOT OK to rewrite their logic
- **Group projects:** Same rules apply - help understand, don't produce deliverables`,
    type: "DOMAIN_WORKFLOW",
    category: "CORE",
    icon: "🎓",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: false,
    permissions: [],
  },
]
