/**
 * Common English given-name equivalences (formal name first). Records often
 * use a nickname on one account and the formal name on another.
 */
const GROUPS: string[][] = [
  ["WILLIAM", "BILL", "BILLY", "WILL", "WILLIE", "WILLY", "LIAM"],
  ["ROBERT", "BOB", "BOBBY", "ROB", "ROBBIE", "BERT"],
  ["RICHARD", "RICK", "RICKY", "DICK", "RICH", "RICHIE"],
  ["JAMES", "JIM", "JIMMY", "JAMIE"],
  ["JOHN", "JACK", "JOHNNY", "JON"],
  ["JOSEPH", "JOE", "JOEY", "JOSE"],
  ["THOMAS", "TOM", "TOMMY"],
  ["CHARLES", "CHUCK", "CHARLIE", "CHAS", "CHAZ"],
  ["MICHAEL", "MIKE", "MICKEY", "MICK"],
  ["DAVID", "DAVE", "DAVEY"],
  ["EDWARD", "ED", "EDDIE", "TED", "TEDDY", "NED"],
  ["ANTHONY", "TONY"],
  ["DANIEL", "DAN", "DANNY"],
  ["MATTHEW", "MATT"],
  ["CHRISTOPHER", "CHRIS", "KIT"],
  ["NICHOLAS", "NICK", "NICKY"],
  ["STEPHEN", "STEVEN", "STEVE", "STEVIE"],
  ["ANDREW", "ANDY", "DREW"],
  ["ALEXANDER", "ALEX", "AL", "SANDY"],
  ["ALBERT", "AL", "BERT"],
  ["ALFRED", "AL", "ALFIE", "FRED"],
  ["FREDERICK", "FRED", "FREDDIE", "FRITZ"],
  ["BENJAMIN", "BEN", "BENNY"],
  ["SAMUEL", "SAM", "SAMMY"],
  ["GERALD", "JERRY", "GERRY"],
  ["GEORGE", "GEORGIE"],
  ["HAROLD", "HAL", "HARRY"],
  ["HENRY", "HANK", "HARRY"],
  ["LAWRENCE", "LARRY", "LARS"],
  ["LEONARD", "LEN", "LENNY", "LEO"],
  ["PATRICK", "PAT", "PADDY"],
  ["PETER", "PETE"],
  ["PHILIP", "PHILLIP", "PHIL"],
  ["RAYMOND", "RAY"],
  ["RONALD", "RON", "RONNIE"],
  ["DONALD", "DON", "DONNIE"],
  ["DOUGLAS", "DOUG"],
  ["EUGENE", "GENE"],
  ["FRANCIS", "FRANK", "FRAN"],
  ["FRANKLIN", "FRANK"],
  ["GREGORY", "GREG"],
  ["JEFFREY", "JEFF"],
  ["JONATHAN", "JON", "JONNY"],
  ["KENNETH", "KEN", "KENNY"],
  ["TIMOTHY", "TIM", "TIMMY"],
  ["WALTER", "WALT", "WALLY"],
  ["ZACHARY", "ZACH", "ZACK"],
  ["ELIZABETH", "LIZ", "LIZZIE", "BETH", "BETTY", "BETSY", "ELIZA", "LIBBY", "BESS"],
  ["MARGARET", "MAGGIE", "PEGGY", "MEG", "MARGE", "MARGIE", "GRETA"],
  ["KATHERINE", "CATHERINE", "KATHRYN", "KATE", "KATHY", "CATHY", "KATIE", "KAY", "KITTY"],
  ["PATRICIA", "PAT", "PATTY", "PATSY", "TRISH", "TRICIA"],
  ["DOROTHY", "DOT", "DOTTIE", "DOLLY"],
  ["DEBORAH", "DEBRA", "DEB", "DEBBIE"],
  ["JENNIFER", "JEN", "JENNY"],
  ["SUSAN", "SUE", "SUSIE", "SUZY"],
  ["BARBARA", "BARB", "BARBIE"],
  ["CHRISTINE", "CHRISTINA", "CHRIS", "TINA", "CHRISSY"],
  ["REBECCA", "BECKY", "BECCA"],
  ["VICTORIA", "VICKY", "TORI"],
  ["JACQUELINE", "JACKIE"],
  ["JUDITH", "JUDY"],
  ["KIMBERLY", "KIM"],
  ["PAMELA", "PAM"],
  ["SAMANTHA", "SAM", "SAMMY"],
  ["THERESA", "TERESA", "TERRY", "TESS"],
  ["VIRGINIA", "GINNY", "GINGER"],
  ["ABIGAIL", "ABBY"],
  ["ALEXANDRA", "ALEX", "SANDRA", "SANDY"],
  ["ELEANOR", "ELLIE", "NELL", "NELLIE"],
  ["FRANCES", "FRAN", "FRANNIE"],
  ["HELEN", "NELL"],
  ["MARY", "MOLLY", "POLLY", "MAE", "MAMIE"],
  ["NANCY", "NAN"],
  ["CAROLYN", "CAROL", "CARRIE"],
  ["CYNTHIA", "CINDY"],
];

const CANONICAL = new Map<string, string[]>();
for (const group of GROUPS) {
  for (const name of group) {
    const list = CANONICAL.get(name) ?? [];
    list.push(group[0]!);
    CANONICAL.set(name, list);
  }
}

/** Formal names a given name may stand for (itself included). */
export function canonicalGivenNames(name: string): string[] {
  return [...new Set([name, ...(CANONICAL.get(name) ?? [])])];
}

/** Primary canonical form, used for blocking keys. */
export function canonicalGivenName(name: string): string {
  return CANONICAL.get(name)?.[0] ?? name;
}

export function areNicknameEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  const ca = canonicalGivenNames(a);
  return canonicalGivenNames(b).some((x) => ca.includes(x));
}
