<!-- Street-address redaction in House holdings and liabilities: the rules, what is kept, the build gate and known blind spots. -->
# Street-address redaction (holdings and liabilities)

Settled decision (`STATUS.md`): street addresses and personal residences are never published. This page lists every
rule that removes a street address from House annual-report text (asset text, liability type and creditor). The
code is `pipeline/holdings/address_rules.py` and `pipeline/holdings/rules.py`; the build gate is
`pipeline/holdings/address_check.py`. Locations are cut to "City, ST" separately. Each removal becomes
`[street address redacted]`, and the holdings report counts rows changed by the newer rules as
`asset_text_redacted_by_extended_rules` and `liability_text_redacted_by_extended_rules`.

Rules were tuned on every row of the pinned holdings source in November 2026 (14,655 liability and 273,900 asset
rows across all documents, not only those published); the review that found the gaps is `docs/REVIEW-2026-11.md` (P1).

## Rules

1. **Suffix rule.** A house number followed by words and a street suffix ("1600 Pennsylvania Ave", "12 N. Main St.")
   is always removed.
2. **Cue rule.** A house number and street name after "on", "at", "secured by" or "located at" is removed whatever
   the suffix ("on 2640 Broadway"). This covers odd numbers (`N2736`, `1s651`), ranges ("2640-2642", "211-213",
   "1210 and 1212"), a following unit or apartment, and year-like numbers followed by a name ("on 1950 Broadway",
   "on 529 Broadway"). On asset text that does not name property, only "secured by" and "located at" count. On
   property or located rows, house numbers followed by "in <City>" with no street name ("at 1035 and 1036 in
   Georgetown, TX") are removed.
3. **Liability rule.** In liability type and creditor text a house number followed by a name is removed even with no
   cue ("HEL - 530 Bowsprit", "1605 Patterson", "CFCU - 3501 South Meade", "Northwest Savings Bank 100 Liberty"), as
   are a year-like number and name on a row about property ("HELOC 2021 Broadway"), a bare trailing number on a
   property row ("rental property, 4609") and a direction plus street number ("300 E 83").
4. **Asset rows that name property or carry a location.** A one-digit "N Name" segment ("9 Jefferson") and a
   year-like number and name at the start of a segment or after a comma, dash, "Acres" or a property word
   ("2093 Charlie Chambers", "30 Acres 2000 Blackjack") are removed; so are a house number followed by a name and a
   street name without a number.
5. **No business-name exemption.** A business name filed with a house number is not exempt: "827 JCB, LLC" becomes
   "[street address redacted], LLC", in assets and liabilities alike.

## Kept as filed

Years, 529 plans, 401(k)/403(b), loan terms, share counts, rates, dates, amounts, fund names, bank names
("121 Financial Credit Union"), months, PO boxes and lot lists ("Lots, 44 and 45"). On year-led asset text a reviewed
allow-list is kept: vehicle makes, "School Bus", 529 "Enrollment" plans, "North American" aircraft,
"FFN 2008 Warranty", "NTS 2013 Erwin", "SC 2024 Revitalization Tax Credit Fund". A street name with no house number is
removed on property rows only when its suffix is unambiguous ("Johnstown Road"); "54th St" stays, since "St" may be Saint.

## Build gate

The holdings validator runs three checks on every published asset and liability text; any hit fails the build: the
suffix rule, the cue rule (on the same segments the redactor uses), and an independent broad check that shares no
pattern with the redactor. The broad check reports a digit-led token followed by a name, "NNN and|& number", and
"cue + numbers + in City" in all liability text and in asset segments that name property or carry a location. Its
keep-list:

- K1: years and 529, unless a capitalised non-quantity word follows;
- K2: ordinals ("2nd Mortgage", "11th St");
- K3: quantity, term, fund, plan, bank, month and tax words, and "Box 123" (a test keeps this list a superset of the
  redactor's quantity words);
- K4: one-digit numbers, unless cued or the whole segment;
- K5: short letter-digit codes ("1A", "B3VA"), upper-case codes of up to four letters after a number of at most three
  digits ("97 FBO") and Russell index codes ("R2000");
- K6: numbers after `$ # . , / -`, or after "(" when a percentage follows, except the end of a range.

## Known blind spots (left as filed; none seen in the source in November 2026)

Number forms the rules do not recognise: "#2640", "No.2640", "Credit-2640 Broadway", "4B Elm" or "12B Elm" with no
cue, "12 College Park", "300 Private", "12 Tax Hill", "2,640 Broadway", "HELOC 529 Broadway", "HELOC 9 Jefferson", a
year-like address in liability text that does not mention property ("Loan 2020 Elm"), "Rental 9 Jefferson", leftover
road tokens ("15CR", "CR"), one- or two-digit house numbers before "in <City>" ("Property at 50 in Polk"), and street names with no house number written with "St" or on non-property rows. The tests in
`pipeline/tests/test_address_redaction.py` pin each one, so a change in behaviour is visible. One shape fails safe instead: a unit or suite list beside a
redacted address ("Condo units 204 & 206, [street address redacted]") is kept by the redactor but reported by the
gate, so a future filing like it stops the build until the keep-list treats unit, suite, apt, parcel and tract like "lot".

Archived releases built before these rules hold about 280 liability rows and 300 asset rows the old rules missed;
whether to withdraw them is the owner's decision (`docs/RELEASE-OPERATIONS.md`, "Withdrawal policy").
