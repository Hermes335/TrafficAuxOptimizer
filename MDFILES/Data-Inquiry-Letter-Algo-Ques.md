# West Visayas State University
**(Formerly Iloilo Normal School)**
**COLLEGE OF INFORMATION AND COMMUNICATIONS TECHNOLOGY**
Luna St., La Paz, Iloilo City 5000, Iloilo, Philippines
* **Trunkline:** (063) (033) 320-0870 to 78 loc. 1403 | **Telefax No.:** (033) 320-0879
* **Website:** www.wvsu.edu.ph | **Email Address:** cict@wvsu.edu.ph

---

**August 17, 2026**

**HON. RAISA S. TREÑAS**
City Mayor
Iloilo City

**Thru:**
**ULDARICO A. GARBANZOS**
City Gov’t Department Head II, POSMO
Vice-Chairperson, TTMO

**Subject:** Performance Metrics Specification & Traffic-Flow Baseline Establishment Protocol

Dear Hon. Treñas,

We are the undersigned 4th year BS Computer Science (Major in Artificial Intelligence) students from West Visayas State University – College of Information and Communications Technology, writing to follow up on our earlier engagement with your office. Last February 5, 2026, we presented our concept study to Ret. Col. Uldarico A. Garbanzos and Engr. Raymund Jarubilla, an engagement featured on the ICTTMO Facebook page, during which TTMO shared initial historical and aggregated traffic management data with us.

Now, as we approach our final thesis defense in the 1st week of October 2026, we are consolidating our response to two items from our 50 percent progress-defense panel's feedback: (3) specify and establish our performance metrics, and (4) build a baseline capturing traffic flow with respect to the number of enforcers deployed, tested against our DSS's guidance.

Part I, on the next page, formally specifies the metrics our system is already built around, with the numeric targets we commit to. Part II lays out the concrete test design — not just a data request — that will produce the flow-vs-officer-count baseline itself, building on the dataset TTMO already shared with us in February. Part III is the follow-up data-collection instrument requesting an updated or expanded dataset to support both parts. Part IV is our working timeline to the October defense.

---

## PART I — PERFORMANCE METRICS: SPECIFICATION & ESTABLISHED TARGETS

Our DSS is a four-objective optimization system. The four objectives below are not proposed — they are already implemented in our NSGA-II engine and were used to produce our Chapter 4 results. This section states them formally, in one place, as the specified and established metric set the panel requested.

### 1.1 Primary Optimization Objectives (Fitness Function)

#### $f_1$ — Coverage Efficiency (Maximize)
Proportion of bottlenecks meeting minimum staffing requirements, weighted by strategic importance:
$$f_1(C) = rac{1}{22} \sum_{i=1}^{22} [	ext{Assigned}_i \ge 	ext{Demand}_i] 	imes 	ext{RPW}_i$$

* **Demand_i (minimum officers):** High severity ($	ext{TSI} > 0.70$) $ightarrow 3$; Medium ($	ext{TSI } 0.40	ext{--}0.70$) $ightarrow 2$; Low ($	ext{TSI} < 0.40$) $ightarrow 1$
* **$	ext{RPW}_i$** = Road Priority Weight for bottleneck $i$, range $[1.0, 2.0]$

#### $f_2$ — Estimated Response Time (Minimize)
Proximity-weighted travel time from assigned officers to their bottlenecks, penalized for weather-degraded speed:
$$f_2(C) = rac{1}{22} \sum_{i=1}^{22} rac{	ext{dist}(	ext{officer}_i, 	ext{bottleneck}_i)}{v_{	ext{avg}} 	imes 	ext{WIF}_i}$$

* $v_{	ext{avg}} = 30	ext{ km/h}$ baseline officer travel speed; unassigned bottlenecks penalized at $D_{\max} = 5,000	ext{ m}$

#### $f_3$ — Weather Responsiveness (Maximize)
Concentration of deployed resources at bottlenecks under active weather-driven capacity loss:
$$f_3(C) = rac{\sum_{i=1}^{22} [	ext{Assigned}_i 	imes 	ext{WIF}_i]}{\sum_{i=1}^{22} 	ext{WIF}_i}$$

* **WIF (Weather Impact Factor):** None $ightarrow 1.00$ | Light $ightarrow 1.10$ | Moderate $ightarrow 1.25$ | Heavy $ightarrow 1.45$ | Flood warning $ightarrow 1.70$

#### $f_4$ — Resource Utilization Balance (Maximize)
Equity of workload distribution across deployed officers:
$$f_4(C) = 1 - rac{\sigma(	ext{assignments\_per\_officer})}{\mu(	ext{assignments\_per\_officer})}$$

---

### 1.2 Scenario-Based Weight Configuration
Objective priorities are established per operational scenario, not left ambiguous. Supervisors select a preset before triggering optimization:

| Scenario | $w$ (Coverage) | $w$ (Weather) | $w$ (Road Priority) | $w$ (Utilization) |
| :--- | :---: | :---: | :---: | :---: |
| **Normal Operations** | 35% | 25% | 25% | 15% |
| **Heavy Rainfall / Typhoon** | 20% | 40% | 25% | 15% |
| **Major Incident** | 35% | 15% | 35% | 15% |
| **Special Event** | 40% | 15% | 30% | 15% |
| **Resource Shortage** | 30% | 25% | 25% | 20% |

---

### 1.3 Constraint Set

**Hard Constraints (must not be violated)**
* **HC1:** One bottleneck assignment per officer per shift
* **HC2:** Critical bottlenecks meet minimum coverage ($	ext{Demand}_i$)
* **HC3:** Shift duration $\le 8$ hours
* **HC4:** Officers on immediately preceding shift are excluded (rest requirement)
* **HC5:** Total assigned officers $\le$ available roster size

**Soft Constraints (penalized, not blocking)**
* **SC1:** Officer location preference
* **SC2:** Balanced workload distribution

---

### 1.4 Algorithm Performance Metrics — Definitions & Established Targets

| Metric | Definition | Established Target |
| :--- | :--- | :--- |
| **Solution Quality** | Best and average fitness across 30 independent runs | Reported, no fixed pass/fail |
| **Convergence Speed** | Generations to reach 95% of final best fitness | Reported for efficiency comparison |
| **Computational Efficiency** | Wall-clock execution time (Intel i7, 16GB RAM) | Reported; sub-5-min target for operational use |
| **Stability** | Coefficient of Variation ($	ext{CV} = \sigma / \mu$) of best fitness across 30 runs | $	ext{CV} < 0.10$ (achieved: 0.0015) |
| **Scalability** | Execution time at 22, 44, 88 bottlenecks; 20, 40, 80 officers | Sub-linear growth expected |

---

### 1.5 System Quality Metrics — Definitions & Established Targets

| Metric | Definition | Established Target |
| :--- | :--- | :--- |
| **ISO/IEC 25010 Quality Score** | Functional Suitability, Performance Efficiency, Usability, Reliability, Security | Scored evaluation, per characteristic |
| **System Usability Scale (SUS)** | Standard 10-item SUS questionnaire administered to ICTTMO personnel | SUS score $> 68$ (“above average”) |
| **Task Completion Time** | Time to generate, evaluate, and approve a deployment plan | $< 10$ minutes for experienced users |

---

### 1.6 External Validation (Supporting, Optional)
To strengthen credibility, we are additionally requesting any documented performance targets TTMO itself uses (response time norms, coverage expectations, congestion thresholds). This is a cross-check against our own specification above, not a substitute for it — see Part III, Section D.

---

## PART II — TRAFFIC-FLOW vs. ENFORCER-COUNT BASELINE: TEST DESIGN

The panel's request has two parts: (a) establish a baseline showing how traffic flow relates to the number of enforcers deployed, and (b) test our DSS's guidance against that baseline. A single before/after week does not produce a baseline curve — it produces one comparison point. The design below produces both the curve and the comparison.

### 2.1 Three-Component Design

* **Component A — Historical Dose-Response Baseline (building on data already shared):**
  TTMO shared an initial set of historical and aggregated traffic management data with us in February 2026. Using that dataset together with an updated/expanded extract requested in Part III, Section A, we plot traffic flow/congestion index (TSI) against the number of enforcers manually deployed, across many past shifts where officer counts naturally varied. This produces the actual baseline curve the panel asked for — flow as a function of headcount — independent of any single test week, and can begin immediately using data already in hand while the updated extract is prepared.

* **Component B — Live Field Pilot: Manual Week vs. DSS-Guided Week:**
  A controlled two-week comparison at the 7-bottleneck Diversion Road + Jaro pilot corridor: Week 1 manual ICTTMO deployment, Week 2 DSS-guided deployment, same shift window, with TSI logged every 5 minutes and enforcer counts logged per bottleneck per shift (see Section 2.4 worksheet).

* **Component C — Statistical Baseline Modeling & DSS Overlay:**
  Component A's data is fit to a regression model of flow vs. officer count. Component B's manual-week points are checked against that curve (as a validity check), and the DSS-guided points are plotted on the same axes. This design enables evaluation of whether DSS-guided assignments yield improved flow outcomes relative to the baseline under comparable operating conditions.

---

### 2.2 Field Schedule

| Phase | Activity | Target Dates |
| :--- | :--- | :--- |
| **Data request** | Send Part III questionnaire to TTMO; begin historical data compilation (Component A) | Aug 17–21, 2026 |
| **Baseline modeling (partial)** | Compile and clean historical dose-response dataset as it arrives | Aug 24–28, 2026 |
| **Field Pilot — Week 1** | Manual ICTTMO baseline, afternoon shift (2:00–10:00 PM), 7 bottlenecks | Sept 1–5, 2026 |
| **Field Pilot — Week 2** | DSS-guided deployment, same shift and corridor | Sept 8–12, 2026 |
| **Analysis** | Regression baseline curve, DSS overlay, significance testing; SUS + ISO 25010 administration | Sept 14–18, 2026 |
| **Write-up** | Draft Chapter 4 baseline findings and metrics results; adviser review | Sept 21–25, 2026 |
| **Finalize** | Manuscript polish, mock defense | Sept 28–Oct 2, 2026 |
| **FINAL DEFENSE** | Present complete metrics + baseline findings | Oct 5–9, 2026 (tentative) |

---

### 2.3 Baseline Data Worksheet
Used for both Component A (historical, TTMO-supplied) and Component B (live pilot, self-captured). One row per bottleneck per shift. *(If possible you can provide us the link of the excel / docs by sending it through: aurelioinocencioiii.sua@wvsu.edu.ph)*

| Date | Shift | Bottleneck | Enforcers Deployed | TSI / Congestion Level | Source (Historical / Pilot-Manual / Pilot-DSS) |
| :--- | :--- | :--- | :--- | :--- | :--- |

---

### 2.4 Statistical Method
* **Baseline curve:** linear (or log, if flow saturates) regression of TSI on enforcer count, fit on Component A data
* **Validity check:** Component B manual-week points compared to the fitted curve's prediction interval
* **DSS effect:** Component B DSS-week points compared to the same curve — paired-difference test (Wilcoxon signed-rank, given small $n$) between manual-week and DSS-week TSI at matched bottleneck/time-slot
* **Effect size:** Cohen's $d$ or matched-pairs rank-biserial correlation, alongside the raw regression plot with DSS points overlaid

---

### 2.5 Success Criteria / Interpretation Guide

| Result Pattern | Interpretation |
| :--- | :--- |
| **DSS-week TSI below the baseline curve's prediction for the same officer count** | DSS achieves better flow than manual deployment would, for equal headcount — strongest result |
| **DSS-week TSI matches the curve, but with fewer officers deployed** | DSS achieves equivalent flow more efficiently — supports resource-utilization claim |
| **DSS-week TSI statistically indistinguishable from manual-week** | No demonstrated flow advantage in this pilot — report honestly; still valid as a coverage/response-time result |

---

## PART III — SUPPORTING DATA-COLLECTION QUESTIONNAIRE (TTMO)

### RESPONDENT INFORMATION
* **Name:** ___________________________________
* **Position/Office:** ___________________________
* **Date:** ___________________________________
* **Contact:** _________________________________

#### A. Historical Deployment & Traffic Flow Records (Follow-up / Expanded Extract)
Building on the historical and aggregated traffic management data TTMO already shared with us in February 2026, we are requesting an updated or expanded extract — ideally covering more recent months, additional bottleneck locations, or both — to strengthen our dose-response baseline ahead of the October defense.

1. **Can TTMO provide an updated/expanded extract of shift-level enforcer counts per location, alongside any traffic flow/congestion reading (TSI, speed, or advisory level) for the same date/time/location?**
   * [ ] Yes
   * [ ] No

   * **Additional date range available:** _______________________________________________
   * **Format (logbook, spreadsheet, system export) (Link):** _______________________________________________

*Even a partial additional export (e.g., 2–3 months beyond what was already shared) with naturally varying officer counts meaningfully strengthens the dose-response curve. If possible sent to `aurelioinocencioiii.sua@wvsu.edu.ph`.*

#### B. List of Identified Traffic Bottlenecks
* **Official list of bottlenecks / high-congestion intersections available?**
  * [ ] Yes
  * [ ] No
  *(If yes, and if possible you can send the digital / online copy/ies to `aurelioinocencioiii.sua@wvsu.edu.ph`)*

#### C. Operational Constraints
* **Standard shift structure(s):** _______________________________________________
* **Minimum / maximum enforcers per location:** _______________________________________________
*(If there’s a digital / copy, send it through `aurelioinocencioiii.sua@wvsu.edu.ph`)*

#### D. Official Performance Standards (External Validation — Part I, §1.6)
* **Does TTMO use documented targets for deployment effectiveness (response time, coverage, congestion thresholds)?**
  * [ ] Yes
  * [ ] No

| Metric / Indicator | Target or Threshold | How Measured |
| :--- | :--- | :--- |
| | | |
| | | |

#### E. Permission for On-Site Documentation
* **Photographs of bottleneck locations / TTMO monitoring area for use as manuscript visuals?**
  * [ ] Yes
  * [ ] No
  * [ ] With conditions (specify below)

  * **Conditions, if any:** _______________________________________________

*All data will be used solely for academic purposes (system simulation, backtesting, evaluation), handled confidentially, and anonymized where necessary.*

---

## PART IV — TIMELINE TO FINAL DEFENSE

Summary view (see also Section 2.2). Roughly 7 weeks from today to the target defense window.

| Week Of | Milestone |
| :--- | :--- |
| **Aug 17** | Submit TTMO questionnaire; finalize Part I metrics write-up for Chapter 3 |
| **Aug 24** | Compile historical baseline dataset as TTMO responds |
| **Sept 1** | Field Pilot Week 1 — Manual baseline |
| **Sept 8** | Field Pilot Week 2 — DSS-guided |
| **Sept 14** | Baseline regression, DSS overlay, SUS/ISO 25010 administration |
| **Sept 21** | Chapter 4 write-up, adviser review |
| **Sept 28** | Manuscript finalization, mock defense |
| **Oct 5–9** | **FINAL DEFENSE** |

---

The requested data will be used solely for academic purposes, particularly for system simulation and back testing. All data will be handled with strict confidentiality, anonymized where necessary, and will not be used for any commercial or non-academic purpose. The results of this study may be shared with the TTMO should the office wish to review the findings or potential applications of the proposed system.

We believe that this research aligns with the city’s ongoing efforts toward data-driven and technology-enabled traffic management. Your support would greatly contribute to the success of this academic endeavor and to the advancement of intelligent transportation research in Iloilo City.

We would be grateful for the opportunity to discuss this request further at your convenience. Thank you very much for your time and consideration.

Respectfully yours,

**Andalajao, Helmer Lorenz A.**
**Amolong, Herald Kent N.**
**Ortilano, Justine Kyle T.**
**Sua, Aurelio Inocencio III S.**

*BS Computer Science 4B - AI,*
*College of ICT*
*WVSU - MAIN CAMPUS*

**For Digital / Online copies of Data in PART II (2.3) and Part III, please send to:**
`aurelioinocencioiii.sua@wvsu.edu.ph`
