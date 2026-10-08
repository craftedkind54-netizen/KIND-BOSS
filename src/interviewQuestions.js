'use strict';

// Source: supplied SMP rules.pdf, pages 1-26. Rank difficulty is interview
// design, not a grant of commands or permissions. See INTERVIEW-UPDATE.md.
const VERSION = 2;
const CATEGORIES = [
  {key:'knowledge',name:'📖 Staff Knowledge',brief:'Apply the rules and reporting routes within the responsibilities of the target rank.',source:'Staff Rules; Reporting Admin Abuse (pp. 17-19)'},
  {key:'anarchy',name:'⚔️ Partial-Anarchy Judgment',brief:'Separate legal anarchy from protection bypasses, cheating and real-world harassment.',source:'Anarchy; Spawn Protection; PvP; Scamming; Coordinates (pp. 4-15)'},
  {key:'evidence',name:'🔎 Evidence & Investigations',brief:'Check evidence, intent and alternative explanations before reaching a conclusion.',source:'Evidence; False Reports; Fake Evidence; Attempts (pp. 19-21)'},
  {key:'punishment',name:'⚖️ Strikes & Punishments',brief:'Explain proportionate action, serious exceptions and why legal gameplay is not punishable. Do not invent strike-to-jail conversions.',source:'Punishments (p. 20); rule-specific annotations'},
  {key:'integrity',name:'🛡️ Staff Integrity',brief:'Prevent staff advantages, favoritism and retaliation; use the private abuse-reporting route.',source:'Staff Rules; No Staff Advantages; Reporting Admin Abuse (pp. 17-19)'},
  {key:'leadership',name:'🧠 Leadership',brief:'Communicate calmly, support fair decisions and route complaints without suppressing criticism.',source:'Discord Rules (pp. 1-4); Reporting Admin Abuse (p. 19); New Situations (p. 25)'},
  {key:'emergency',name:'🚨 Emergency Judgment',brief:'Stop serious immediate damage within authorized access, preserve evidence and coordinate follow-up.',source:'Private Information (pp. 3-4); Exploits (pp. 8-9); Server Crashing (pp. 16-17); New Situations (p. 25)'},
  {key:'rank',name:'🎯 Rank-Specific',brief:'Demonstrate readiness for the target rank through practical rule-based decisions.',source:'Staff Rules; Evidence; Punishments; New Situations (pp. 17-25)'},
  {key:'bonus',name:'😈 Bonus / Troll Check',bonus:true,brief:'These questions are not mainly about getting the correct answer. They test personality, maturity, creativity and reactions under pressure. Keep it playful and respectful; no real permission changes or rule-breaking. Record observations, not a right-or-wrong score.',source:'User-supplied creative prompts; staff-integrity boundaries from SMP rules.pdf (pp. 17-19)'}
];

const FOCUS = {
  general:'Basic reports, clear explanations, evidence collection and timely escalation.',
  head_general:'Coaching General Staff, checking routine decisions and preparing clear escalations.',
  senior:'Serious investigations, disputed punishments, evidence review and support for General Staff.',
  head_senior:'Consistency across Senior Staff, complex case reviews and leadership escalation.',
  co_owner:'Oversight of major incidents, staff accountability and escalation of Co-Owner complaints to the Owner.',
  owner:'Final accountability, fair policy decisions and independent review of complaints about the Owner.'
};

// Ordered to match the eight scored tabs; bonus guidance is added below.
const EVALUATIONS = {
  general: [
    'Explain everyday rules and know when to ask higher staff for help.',
    'Recognize legal raids, theft and PvP versus protected-area violations.',
    'Collect clear report details without treating accusations as proof.',
    'Apply routine warnings fairly and recognize serious cases needing escalation.',
    'Keep staff tools out of personal gameplay and report abuse privately.',
    'Stay calm, explain decisions respectfully and accept legitimate criticism.',
    'Recognize urgent harm, protect private information and call for authorized help.',
    'Handle a basic report responsibly from intake to handoff.'
  ],
  head_general: [
    'Teach General Staff the rules, staff-tool limits and reporting routes.',
    'Coach consistent decisions about legal anarchy and protected areas.',
    'Check routine evidence collection and improve handoffs to Senior Staff.',
    'Correct inconsistent warnings and unsupported punishment assumptions.',
    'Recognize favoritism or retaliation in the team and route abuse reports fairly.',
    'Mentor General Staff and resolve disagreements calmly using the rules.',
    'Organize first-response tasks and consolidate urgent reports for higher staff.',
    'Demonstrate readiness to guide General Staff and document recurring problems.'
  ],
  senior: [
    'Lead serious case reviews and explain escalation routes to General Staff.',
    'Resolve complex cases involving legal raids, hidden-information cheats and harassment.',
    'Corroborate cheating, ban evasion and exploit evidence; review conflicting accounts.',
    'Review serious punishments and appeals for evidence, intent and proportionality.',
    'Investigate moderator abuse fairly and escalate Senior Staff complaints to leadership.',
    'Support General Staff, explain disputed outcomes and remain professional under pressure.',
    'Coordinate authorized containment of exploits while preserving evidence and privacy.',
    'Carry serious investigations from a General Staff handoff to a reasoned outcome.'
  ],
  head_senior: [
    'Maintain consistent investigation standards across Senior Staff.',
    'Resolve inconsistent interpretations of anarchy, protection and hidden-information rules.',
    'Audit complex investigations and reconcile contradictory evidence reviews.',
    'Review major punishment inconsistencies and avoid retroactive enforcement.',
    'Protect independent review and escalate alleged Senior Staff abuse to leadership.',
    'Guide Senior Staff through disagreements and communicate corrections professionally.',
    'Coordinate multiple investigators and review emergency actions after containment.',
    'Oversee difficult case reviews and prepare clear leadership handoffs.'
  ],
  co_owner: [
    'Oversee serious staff cases and preserve the Owner reporting route for Co-Owner complaints.',
    'Uphold the legal-anarchy boundary despite community or leadership pressure.',
    'Require corroboration and individual findings in major or staff-related investigations.',
    'Review severe responses without mass guilt, favoritism or retroactive rules.',
    'Protect accountability for senior staff and refer complaints about yourself to the Owner.',
    'Resolve leadership disputes and base staffing recommendations on demonstrated conduct.',
    'Coordinate major incident oversight, authorized containment and Owner communication.',
    'Demonstrate leadership oversight through documented cases and fair staff recommendations.'
  ],
  owner: [
    'Accept that staff rules apply to the Owner and enable review by other highest-ranking staff.',
    'Uphold published anarchy rules and communicate protection changes prospectively.',
    'Require credible independent review even when evidence concerns you or your friends.',
    'Correct major errors and keep final decisions fair, evidenced and non-retroactive.',
    'Accept scrutiny, prevent retaliation and model responsible use of staff permissions.',
    'Explain difficult decisions, delegate responsibly and acknowledge mistakes publicly when appropriate.',
    'Oversee containment and recovery without using emergencies for personal gameplay benefit.',
    'Demonstrate final accountability for policy, leadership decisions and your own conduct.'
  ]
};

const QUESTIONS = {
  general: {
    knowledge: [
      'A player asks you to restore a legally raided base. What do the rules allow you to do?',
      'Which uses of spectator are legitimate investigations, and which create a forbidden survival advantage?',
      'You receive an abuse report about a moderator. What evidence would you collect and where should it go?',
      'A player asks whether an unfamiliar client mod is allowed. What rule criteria would you check before answering?'
    ],
    anarchy: [
      'A player steals diamonds from an unprotected chest. How would you explain whether this breaks a rule?',
      'Someone fires TNT into protected spawn from outside its boundary. Does standing outside make this legal?',
      'A raided player shares Minecraft coordinates, then threatens to share a home address. How do these differ?',
      'A player loses items in an unprotected portal trap. What would make the trap illegal instead?'
    ],
    evidence: [
      'Chat accuses a player of X-ray without proof. What facts would you record and pass to an investigator?',
      'A screenshot appears to show a threat. How would you check its context and preserve it privately?',
      'A player disconnects once during combat. What would you check before calling it combat logging?',
      'Someone reports receiving suspicious items and has stopped using them. What details would you collect?'
    ],
    punishment: [
      'A player repeatedly spams after a warning. How does the small-offense progression guide your next step?',
      'Automod flags part of an ordinary word as cussing. Should the player be punished, and why?',
      'A player posts private information. Why might this require urgent escalation rather than an ordinary warning?',
      'A player demands a strike for legal PvP outside protection. How would you respond?'
    ],
    integrity: [
      'Your friend asks you to use /give to replace loot lost in a legal raid. What do you say?',
      'While investigating, you learn a hidden base location. May you use that knowledge in survival?',
      'A moderator asks you to hide evidence of spectator abuse. What private reporting route should you use?',
      'You are angry after losing a fight. Why is teleporting away with staff tools unacceptable?'
    ],
    leadership: [
      'A player says a server rule is bad. How do you allow criticism while stopping personal harassment?',
      'A public argument becomes accusations and dogpiling. How would you redirect it to Support calmly?',
      'You cannot determine whether a bug is an exploit. How would you ask for help without claiming certainty?',
      'A teammate proposes punishing a legal raid. How would you explain the relevant rule respectfully?'
    ],
    emergency: [
      'Private information appears in chat while a player reports a stolen in-game item. What needs immediate attention?',
      'You see a suspected crash exploit but lack the access to contain it. What should you report urgently?',
      'A player privately reports a new dupe. How would you keep details from spreading and get help?',
      'A machine appears to be damaging TPS. What would you observe before calling it an intentional lag machine?'
    ],
    rank: [
      'Walk through your first report of protected spawn griefing: facts, evidence, explanation and escalation.',
      'How would you explain that a large farm is allowed but may need changes if it harms performance?',
      'A new player confuses legal betrayal with account theft. How would you explain the boundary?',
      'What would you do if a routine report requires tools or decisions you are not authorized to use?'
    ]
  },
  head_general: {
    knowledge: [
      'How would you train General Staff to distinguish normal client mods from hidden-information cheats?',
      'A trainee believes staff are exempt from PvP rules. How would you correct that misunderstanding?',
      'How would you teach the private abuse-reporting routes for moderators, Senior Staff and Co-Owners?',
      'What should a General Staff handoff contain before a serious cheating report goes to Senior Staff?'
    ],
    anarchy: [
      'Two General Staff disagree about restoring an unprotected community build. How would you coach their decision?',
      'A trainee treats repeated legal raids as automatic harassment. How would you teach the gameplay/Discord distinction?',
      'How would you review a trainee response to a TNT cannon damaging spawn from outside protection?',
      'A General Staff member bans all portal traps. What rule examples would you use to correct the advice?'
    ],
    evidence: [
      'A trainee treats several accusations as proof of hacking. How would you improve their evidence handoff?',
      'Two routine reports contain conflicting screenshots. What checks would you ask General Staff to perform?',
      'A trainee omits the protection boundary from a griefing report. Why does that matter and how do you fix it?',
      'How would you teach staff to record possible combat logging without confusing a crash with intent?'
    ],
    punishment: [
      'General Staff give inconsistent responses to repeated spam. How would you align them with the punishment progression?',
      'A trainee insists every serious violation needs a warning first. How would you correct this using the rules?',
      'A staff member invents a jail duration from a number beside a rule. What must they verify before acting?',
      'A trainee punishes an ordinary alt account. How would you review and explain the error?'
    ],
    integrity: [
      'A General Staff member offers to restore a friend\'s legally raided base. How would you intervene and document it?',
      'A trainee shares investigation-derived coordinates with their survival team. What makes this staff abuse?',
      'A moderator you mentor is accused of /give abuse. How do you preserve evidence and route the complaint fairly?',
      'A General Staff member wants to punish someone who criticized their decision. How would you address retaliation?'
    ],
    leadership: [
      'How would you coach a General Staff member who turns Support disputes into public arguments?',
      'Two trainees disagree about a freecam screenshot. How would you guide them to the hidden-information rule?',
      'How would you prepare a concise escalation when routine staff cannot resolve a protection-bypass report?',
      'A new mechanic is unclear to your team. How would you prevent staff from presenting guesses as existing rules?'
    ],
    emergency: [
      'During a doxxing incident, how would you organize General Staff to limit exposure and notify authorized responders?',
      'General Staff are flooded with crash reports. How would you consolidate evidence for Senior Staff?',
      'A trainee wants to post dupe instructions publicly as a warning. How would you redirect them?',
      'An urgent lag report arrives during routine chat moderation. How would you assign collection and escalation tasks?'
    ],
    rank: [
      'Design a short coaching exercise that teaches General Staff legal theft versus protected-spawn theft.',
      'A General Staff member repeatedly ignores evidence checks. How would you document the pattern for higher review?',
      'How would you audit routine reports for favoritism without assuming every mistake is deliberate abuse?',
      'What would a clear handoff from your team to Senior Staff look like for suspected ban evasion?'
    ]
  },
  senior: {
    knowledge: [
      'As Senior Staff, how would you take over a General Staff cheating report while keeping evidence and conclusions separate?',
      'A moderator is accused of spectator abuse. How would you investigate, and where must a complaint about Senior Staff go?',
      'How would you distinguish permitted investigative use of inventory logs from using those logs for survival advantage?',
      'How would you explain to General Staff when serious violations may skip the ordinary warning progression?'
    ],
    anarchy: [
      'A legal raid is followed by sustained personal attacks on Discord. How would you separate the two parts of the case?',
      'A base was found using either Nether trails or ESP. How would the method change your ruling?',
      'A player claims a freecam session was only for screenshots, but hidden stashes were found. What matters to your decision?',
      'A trap outside spawn injures players still inside protection. How would you investigate the bypass claim?'
    ],
    evidence: [
      'General Staff suspect ban evasion on a borrowed account. How would you corroborate evasion without treating every alt as guilty?',
      'Anti-cheat alerts and video disagree about a combat incident. How would you weigh context and alternative explanations?',
      'Several players received duped items. How would you distinguish knowing storage or distribution from prompt reporting?',
      'An appeal alleges that screenshots were fabricated. What original records would you compare before deciding?'
    ],
    punishment: [
      'A cheating case is serious but disputed. How would you justify action using evidence and severity rather than accusation volume?',
      'How would you review a punishment for combat logging when a combat-tag system may not have been active?',
      'A player tried but failed to crash the server. What evidence of intent is needed before treating the attempt as a violation?',
      'An appeal shows a punishment was imposed for legal unprotected griefing. How would you address the decision and explain it?'
    ],
    integrity: [
      'A moderator used spectator to locate a base and later raided it. How would you investigate the link without favoritism?',
      'A Senior Staff colleague is accused of hiding duped items. How would you preserve the report and escalate to Co-Owner or Owner?',
      'Your survival ally is involved in an exploit case you are reviewing. How would you manage that conflict of interest?',
      'You discover your own investigation exposed base information to a teammate. How would you report and address the mistake?'
    ],
    leadership: [
      'General Staff disagree about an exploit case. How would you lead an evidence-based review and explain the outcome?',
      'A player criticizes your appeal decision publicly. How would you preserve their right to criticize while stopping harassment?',
      'How would you coach General Staff after they confused a permitted automatic farm with forbidden software automation?',
      'A new bug causes harm but no rule addresses it clearly. How would you escalate uncertainty without applying a future rule retroactively?'
    ],
    emergency: [
      'An active dupe is spreading while chat fills with accusations. How would you coordinate containment, evidence and communication?',
      'A crash exploit is suspected in one area. What authorized containment and evidence checks would you prioritize?',
      'A farm causes severe lag, but intent is unclear. How would you reduce harm without assuming it is a deliberate lag machine?',
      'Doxxing and cheating reports arrive together. How would you protect private information while delegating the investigation?'
    ],
    rank: [
      'Walk through taking a General Staff report of ban evasion from initial evidence to a reasoned review outcome.',
      'How would you review a disputed major punishment when the reporter and accused provide conflicting logs?',
      'A group used a protection exploit, but members played different roles. How would you assess each person\'s knowledge and conduct?',
      'What should your escalation to leadership include when a serious case implicates another Senior Staff member?'
    ]
  },
  head_senior: {
    knowledge: [
      'How would you check that Senior Staff use the same evidence standard in serious investigations?',
      'A Senior Staff investigator is accused of abuse. How would you route it to Co-Owner or Owner while preserving case records?',
      'How would you review whether investigative staff tools were used for a legitimate purpose across several cases?',
      'How would you brief Senior Staff on the distinction between established rules and genuinely new situations?'
    ],
    anarchy: [
      'Two Senior Staff disagree whether a raid plus Discord harassment should invalidate all gameplay. How would you separate findings?',
      'Case reviews reveal community builds were treated as protected without official protection. How would you address consistency?',
      'How would you resolve conflicting rulings on freecam building screenshots versus hidden-base discovery?',
      'A disputed boundary case involves portals and explosions. How would you lead a review of who was actually protected?'
    ],
    evidence: [
      'Senior Staff reach opposite conclusions from the same anti-cheat data. How would you structure an independent review?',
      'A major appeal alleges planted cheated items. What gaps would you require investigators to resolve?',
      'How would you review several linked dupe investigations without assuming guilt by association?',
      'An investigator relied on a clipped video and ignored logs. How would you audit the conclusion and correct the process?'
    ],
    punishment: [
      'Similar exploit cases received very different punishments. How would you compare severity, intent and evidence?',
      'A Senior Staff decision punished a newly discovered mechanic under a later rule. How would you review that reasoning?',
      'An appeal challenges an immediate punishment for a failed crash attempt. What must the record show?',
      'How would you review a pattern of punishments for legal raids without replacing evidence review with automatic reversals?'
    ],
    integrity: [
      'A Senior Staff team appears to protect friends from exploit findings. How would you preserve evidence for leadership review?',
      'You supervised a disputed investigation. How would you arrange a fair review of your own involvement?',
      'Staff logs suggest investigative access was used to plan raids. How would you keep review access from enabling further abuse?',
      'A good-faith complainant fears retaliation by Senior Staff. How would you protect the reporting process?'
    ],
    leadership: [
      'How would you resolve a Senior Staff disagreement without letting seniority substitute for the actual rules?',
      'What would you include in a leadership escalation about repeated inconsistent evidence handling?',
      'How would you teach Senior Staff to explain overturned punishments without exposing private information?',
      'An unclear mechanic divides the team. How would you recommend a clarification while avoiding retroactive enforcement?'
    ],
    emergency: [
      'Several Senior Staff respond to a crash and dupe incident at once. How would you coordinate roles and avoid conflicting actions?',
      'A suspected staff permission exploit is active. What would you escalate immediately and what evidence must be preserved?',
      'Emergency containment also blocks legitimate farming. How would you review its scope as new evidence arrives?',
      'After an incident is contained, how would you organize a review of staff actions and unresolved player cases?'
    ],
    rank: [
      'How would you lead a difficult appeal review where two Senior Staff investigations contradict each other?',
      'What recurring case-quality problems would you coach directly, and what alleged Senior Staff misconduct goes to leadership?',
      'How would you evaluate whether Senior Staff are applying the legal-anarchy boundary consistently?',
      'Prepare the outline of a leadership handoff for a major staff-abuse case involving multiple investigators.'
    ]
  },
  co_owner: {
    knowledge: [
      'How would you oversee a serious Senior Staff abuse complaint while keeping the review independent?',
      'A complaint concerns your own actions as Co-Owner. What reporting route must remain available?',
      'How would you ensure leadership access to console and logs is used only for legitimate staff purposes?',
      'How would you distinguish an explicit Owner approval for real-money trading from an assumed exception?'
    ],
    anarchy: [
      'Influential players demand protection for every community build after a legal raid. How would you apply current rules fairly?',
      'A major conflict combines legal wars, real-money scams and doxxing. How would you separate the issues for review?',
      'Staff propose a broad ban on normal client mods after an ESP incident. How would you test that response against the rules?',
      'A group pressures leadership to restore a friend\'s unprotected base. How would you explain a consistent decision?'
    ],
    evidence: [
      'A Senior Staff abuse case contains conflicting staff and player accounts. How would you arrange corroboration and fair review?',
      'An economy-wide dupe case implicates traders and recipients. How would you require evidence of knowing participation?',
      'A leadership complaint alleges fabricated staff messages. What original records would you seek?',
      'How would you review an investigation that collected private information beyond what its decision needs?'
    ],
    punishment: [
      'Staff request mass bans after a dupe outbreak. How would you require individual evidence and proportionate decisions?',
      'A serious abuse finding involves a well-liked Senior Staff member. How would you avoid favoritism in the response?',
      'How would you review immediate action for doxxing while still checking the facts and scope of the violation?',
      'A proposed punishment relies on a rule clarification published after the incident. How would you address that?'
    ],
    integrity: [
      'Evidence suggests you benefited from staff-derived base information. How would you refer your own conduct to the Owner?',
      'A Head Staff member asks you to suppress a friend\'s abuse complaint. What should you do?',
      'A senior investigator used console access for survival advantage. How would you protect the review from leadership pressure?',
      'How would you ensure staff can privately report your mistakes without losing their right to criticize decisions?'
    ],
    leadership: [
      'Senior Staff cannot resolve a major exploit disagreement. How would you lead a rule-based decision and explain uncertainties?',
      'How would repeated evidence fabrication or favoritism affect your recommendation about staff responsibilities?',
      'A leadership dispute spills into public dogpiling. How would you restore a private review while allowing criticism?',
      'How would you propose a new exploit clarification to the Owner without pretending it always existed?'
    ],
    emergency: [
      'A major exploit is damaging the economy across several teams. How would you coordinate authorized containment and notify the Owner?',
      'A crash incident may involve staff access. How would you arrange evidence preservation and review of access?',
      'An emergency responder proposes a rollback to restore their own legally raided base. How would you assess and reject misuse?',
      'After a privacy leak is contained, how would you coordinate follow-up without redistributing the leaked information?'
    ],
    rank: [
      'Walk through oversight of a serious complaint about Senior Staff from private intake to a documented decision.',
      'When a case implicates a Co-Owner, how would you keep the Owner informed without prejudging the evidence?',
      'How would you evaluate a staff promotion recommendation using evidence of fairness and rule knowledge rather than friendship?',
      'How would you brief the Owner after a major exploit, including confirmed facts, unresolved cases and proposed clarifications?'
    ]
  },
  owner: {
    knowledge: [
      'How would you make sure the rules apply to your own use of staff tools as Owner?',
      'The rules direct complaints about the Owner to the other highest-ranking staff. How would you make that review meaningful?',
      'How would you communicate any explicit real-money-trading approval so staff do not invent wider exceptions?',
      'How would you resolve uncertainty in the published rules without treating your preference as a rule that already existed?'
    ],
    anarchy: [
      'The community wants a legal war reversed because popular players lost. How would you uphold the published anarchy rules?',
      'How would you decide and communicate official protection for a public area without retroactively punishing earlier legal raids?',
      'A major controversy mixes legal coordinate sharing with leaked home addresses. How would you explain the different rulings?',
      'How would you review leadership decisions that label normal griefing as harassment to protect favored players?'
    ],
    evidence: [
      'A final leadership review implicates your closest teammate. How would you make the evidence review credible and independent?',
      'Staff disagree whether a new mechanic was abusive or genuinely unforeseen. What evidence would guide the final assessment?',
      'A complaint about you includes logs you control. How would you preserve them for review by other highest-ranking staff?',
      'A server-wide investigation relies on unverified accusations. What checks would you require before accepting its conclusions?'
    ],
    punishment: [
      'How would you correct a major leadership decision that punished legal anarchy gameplay?',
      'How would you review a proposed immediate ban for serious staff abuse without allowing status to influence the evidence standard?',
      'An ambiguous rule annotation is being treated as a mandatory jail formula. How would you clarify policy and review affected decisions?',
      'How would you keep a new exploit rule from being used as though it existed before publication?'
    ],
    integrity: [
      'You used staff access to gain a survival advantage. What accountability should follow under the rules?',
      'Other highest-ranking staff receive a good-faith complaint about you. How would you avoid obstructing or retaliating against the review?',
      'A friend asks you to rollback a legal raid against their base. How would you uphold the staff-advantage rules?',
      'How would you correct a culture where staff believe Owner friendship excuses evidence destruction or favoritism?'
    ],
    leadership: [
      'How would you explain an unpopular but rule-consistent decision while preserving the right to criticize it?',
      'Leadership repeatedly disagrees about new mechanics. How would you publish clear prospective guidance?',
      'How would you assign serious reviews to capable staff while retaining accountability for the final policy decision?',
      'You discover a major decision you defended was wrong. How would you explain the correction without exposing private case material?'
    ],
    emergency: [
      'A crash exploit threatens server data. How would you coordinate authorized technical containment, evidence preservation and recovery?',
      'A permission exploit may have enabled staff abuse. How would you oversee access review without destroying investigation records?',
      'A proposed rollback could also reverse legal raids. How would you distinguish necessary incident recovery from forbidden personal benefit?',
      'After simultaneous doxxing and exploit incidents, how would you oversee follow-up and publish safe, factual updates?'
    ],
    rank: [
      'How would you demonstrate final accountability when both a server policy and your own conduct are challenged?',
      'How would you review a Co-Owner abuse complaint fairly despite your working relationship?',
      'What would your final review require before accepting a major punishment recommendation with disputed evidence?',
      'How would you turn lessons from an unforeseen exploit into clear future rules without rewriting the past?'
    ]
  }
};

const BONUS_PROMPTS = [
  'You receive Owner permissions for exactly five minutes. What is the FIRST thing you do?',
  'Without breaking character, convince the board that ketchup is technically a soup.',
  'Defend this statement: noodles belong on pizza.',
  'Explain with complete confidence why coffee is secretly a type of tea.',
  'A creeper applies for General Staff. Conduct a 20-second interview and decide what questions you would ask it.',
  'You discover the Owner has secretly replaced every diamond on the server with potatoes. How do you write the incident report?',
  'Explain why a chicken would make a terrible Senior Staff member without insulting the chicken.',
  'You are allowed to create ONE completely useless staff command. What does it do?'
];
const BONUS_FOLLOWUPS = {
  general: [
    'How would you check whether that access was intentional before using it?',
    'How would you stay friendly if a player disagrees with your soup theory?',
    'How would you respond calmly to a player who hates this idea?',
    'How would you admit the difference between a joke and a factual staff answer?',
    'What basic rule would you ask the creeper to explain?',
    'Which facts would you record, and who would you ask for help?',
    'How would you give that feedback kindly?',
    'How would you keep it harmless to players and their items?'
  ],
  head_general: [
    'What would you teach General Staff about unexpected permissions?',
    'How would you coach a trainee whose soup debate becomes personal?',
    'How would you settle two trainees arguing about your pizza claim?',
    'How would you stop a trainee from presenting your joke as official guidance?',
    'What feedback would you give a trainee who interviewed the creeper?',
    'How would you help General Staff prepare a clear handoff about the potatoes?',
    'How would you model constructive feedback for a trainee watching?',
    'How would you teach the team when using it would be inappropriate?'
  ],
  senior: [
    'How would you verify the access and avoid disrupting an active investigation?',
    'How would you distinguish your confident pitch from actual evidence?',
    'How would you de-escalate if two staff turn the debate into a dispute?',
    'What would you do if General Staff repeated your claim as a verified fact?',
    'What evidence-handling scenario would you ask the creeper to solve?',
    'How would you separate verified changes from rumors in the report?',
    'How would you explain an evidence-based readiness concern respectfully?',
    'How would you check it cannot leak investigation information?'
  ],
  head_senior: [
    'How would you coordinate with Senior Staff before any authorized action?',
    'How would you review two investigators reaching opposite soup conclusions?',
    'How would you keep the leadership of this debate fair and good-humored?',
    'How would you correct inconsistent staff guidance caused by the joke?',
    'How would you review the fairness of the creeper interview?',
    'How would you organize conflicting potato reports for leadership review?',
    'How would you coach Senior Staff to give similarly respectful feedback?',
    'How would you evaluate whether it distracts staff during incidents?'
  ],
  co_owner: [
    'What would you confirm with the Owner, and how would you account for your actions?',
    'How would you leave room for staff to challenge your soup authority?',
    'How would you stop your rank from making everyone pretend to agree?',
    'How would you correct a public misunderstanding created by your confidence?',
    'How would you prevent favoritism if the creeper were your friend?',
    'How would you raise the concern with the Owner professionally?',
    'How would you keep a staffing discussion constructive rather than humiliating?',
    'What oversight would keep the joke from becoming staff-tool abuse?'
  ],
  owner: [
    'Assume these are temporary permissions on a test server: how would you model restraint?',
    'How would you show that disagreement with the Owner is welcome?',
    'How would you keep your personal preference from becoming compulsory policy?',
    'How would you own the mistake if your joke misled the community?',
    'How would you demonstrate a fair final decision about the creeper?',
    'How would you accept independent review if you caused the potato incident?',
    'How would you model accountability and respect in the final staffing decision?',
    'How would you ensure the command does not undermine trust in staff permissions?'
  ]
};
for(const rank of Object.keys(QUESTIONS)){
  QUESTIONS[rank].bonus=BONUS_PROMPTS.map((prompt,i)=>`${prompt} Follow-up: ${BONUS_FOLLOWUPS[rank][i]}`);
  EVALUATIONS[rank].push(`Show creativity, maturity and calm under playful pressure as ${rank.replaceAll('_',' ')}; discuss responsible permissions without acting out the scenario. This bonus is unscored.`);
}

function categoryFor(targetRank, index) {
  const category = CATEGORIES[index];
  if (!category || !Object.hasOwn(QUESTIONS, targetRank)) throw new RangeError('Unknown interview rank or category');
  return {...category, qs: [...QUESTIONS[targetRank][category.key]], focus: FOCUS[targetRank], evaluation: EVALUATIONS[targetRank][index]};
}

function snapshot(targetRank) {
  return CATEGORIES.map((_, index) => categoryFor(targetRank, index));
}

module.exports = {VERSION, CATEGORIES, FOCUS, EVALUATIONS, QUESTIONS, BONUS_PROMPTS, categoryFor, snapshot};
