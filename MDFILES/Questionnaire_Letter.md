# WEST VISAYAS STATE UNIVERSITY
## College of Information and Communications Technology
### BSCS 3B — Group 6

**PERFORMANCE METRICS SPECIFICATION & TRAFFIC-FLOW BASELINE ESTABLISHMENT PROTOCOL**  
*Response to Progress-Defense Panel Feedback (Items 3 & 4)*  
**Traffic Manpower Deployment Decision Support System for Iloilo City Using Genetic Algorithm** | *Final Defense: 1st Week of October 2026*

---

This document consolidates our response to two items from our progress-defense panel's feedback: 
3. Specify and establish our performance metrics.
4. Build a baseline capturing traffic flow with respect to the number of enforcers deployed, tested against our DSS's guidance.

* **Part I** formally specifies the metrics our system is already built around, with the numeric targets we commit to.
* **Part II** lays out the concrete test design — not just a data request — that will produce the flow-vs-officer-count baseline itself.
* **Part III** is the data-collection instrument sent to TTMO to support both parts.
* **Part IV** is our working timeline to the October defense.

---

## PART I — PERFORMANCE METRICS: SPECIFICATION & ESTABLISHED TARGETS

Our DSS is a four-objective optimization system. The four objectives below are not proposed — they are already implemented in our NSGA-II engine and were used to produce our Chapter 4 results. This section states them formally, in one place, as the specified and established metric set the panel requested.

### 1.1 Primary Optimization Objectives (Fitness Function)

#### $f_1$ — Coverage Efficiency (Maximize)
Proportion of bottlenecks meeting minimum staffing requirements, weighted by strategic importance:

$$f_1(C) = rac{1}{22} \sum_{i=1}^{22} [	ext{Assigned}_i \ge 	ext{Demand}_i] 	imes 	ext{RPW}_i$$

* **$	ext{Demand}_i$ (minimum officers):** High severity ($	ext{TSI} > 0.70$) $ightarrow$ 3; Medium ($	ext{TSI } 0.40–0.70$) $ightarrow$ 2; Low ($	ext{TSI} < 0.40$) $ightarrow$ 1
* **$	ext{RPW}_i$:** Road Priority Weight for bottleneck $i$, range $[1.0, 2.0]$

#### $f_2$ — Estimated Response Time (Minimize)
Proximity-weighted travel time from assigned officers to their bottlenecks, penalized for weather-degraded speed:

$$f_2(C) = rac{1}{22} \sum_{i=1}^{22} \left[ rac{	ext{dist}(	ext{officer}_i, 	ext{bottleneck}_i)}{v_{	ext{avg}} 	imes 	ext{WIF}_i} ight]$$

* $v_{	ext{avg}} = 30	ext{ km/h}$ baseline officer travel speed; unassigned bottlenecks penalized at $D_{\max} = 5,000	ext{ m}$

#### $f_3$ — Weather Responsiveness (Maximize)
Concentration of deployed resources at bottlenecks under active weather-driven capacity loss:

$$f_3(C) = rac{\sum_{i=1}^{22} [	ext{Assigned}_i 	imes 	ext{WIF}_i]}{\sum_{i=1}^{22} 	ext{WIF}_i}$$

* **WIF (Weather Impact Factor):** None $ightarrow 1.00$ | Light $ightarrow 1.10$ | Moderate $ightarrow 1.25$ | Heavy $ightarrow 1.45$ | Flood warning $ightarrow 1.70$

#### $f_4$ — Resource Utilization Balance (Maximize)
Equity of workload distribution across deployed officers:

$$f_4(C) = 1 - \left[ rac{\sigma(	ext{assignments\_per\_officer})}{\mu(	ext{assignments\_per\_officer})} ight]$$

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

#### Hard Constraints (must not be violated)
* **HC1:** One bottleneck assignment per officer per shift
* **HC2:** Critical bottlenecks meet minimum coverage ($	ext{Demand}_i$)
* **HC3:** Shift duration $\le 8	ext{ hours}$
* **HC4:** Officers on immediately preceding shift are excluded (rest requirement)
* **HC5:** Total assigned officers $\le$ available roster size

#### Soft Constraints (penalized, not blocking)
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
| **Task Completion Time** | Time to generate, evaluate, and approve a deployment plan | $< 10	ext{ minutes}$ for experienced users |

These are the metrics our system is evaluated against. They are internally specified and do not depend on TTMO's reply. Section 1.6 and Part III add an external, real-world reference point — useful for validation, not required to satisfy this feedback item.

---

### 1.6 External Validation (Supporting, Optional)

To strengthen credibility, we are additionally requesting any documented performance targets TTMO itself uses (response time norms, coverage expectations, congestion thresholds). This is a cross-check against our own specification above, not a substitute for it — see Part III, Section G.

---

## PART II — TRAFFIC-FLOW vs. ENFORCER-COUNT BASELINE: TEST DESIGN

The panel's request has two parts: (a) establish a baseline showing how traffic flow relates to the number of enforcers deployed, and (b) test our DSS's guidance against that baseline. A single before/after week does not produce a baseline curve — it produces one comparison point. The design below produces both the curve and the comparison.

### 2.1 Three-Component Design

* **Component A — Historical Dose-Response Baseline (no new field days required)**  
  Using TTMO's historical shift records (Part III, Section A), we plot traffic flow/congestion index (TSI) against the number of enforcers manually deployed, across many past shifts where officer counts naturally varied. This produces the actual baseline curve the panel asked for — flow as a function of headcount — independent of any single test week, and can begin as soon as TTMO responds.

* **Component B — Live Field Pilot: Manual Week vs. DSS-Guided Week**  
  A controlled two-week comparison at the 7-bottleneck Diversion Road + Jaro pilot corridor: Week 1 manual ICTTMO deployment, Week 2 DSS-guided deployment, same shift window, with TSI logged every 5 minutes and enforcer counts logged per bottleneck per shift (see Section 2.4 worksheet).

* **Component C — Statistical Baseline Modeling & DSS Overlay**  
  Component A's data is fit to a regression model of flow vs. officer count. Component B's manual-week points are checked against that curve (as a validity check), and the DSS-guided points are plotted on the same axes. This directly answers whether the DSS achieves better flow than the baseline predicts for the same officer count — or equal flow with fewer officers.

---

### 2.2 Revised Field Schedule (aligned to October defense)

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

*Confirm the exact October defense date with your adviser/college and adjust the schedule above accordingly — dates here assume the first full week of October.*

---

### 2.3 Baseline Data Worksheet

Used for both Component A (historical, TTMO-supplied) and Component B (live pilot, self-captured). One row per bottleneck per shift.

| Date | Shift | Bottleneck | Enforcers Deployed | TSI / Congestion Level | Source (Historical / Pilot-Manual / Pilot-DSS) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| | | | | | |

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

Sent to the Office of the City Mayor / TTMO. Supplies the historical data for Part II, Component A, and the external validation referenced in Part I, Section 1.6.

### RESPONDENT INFORMATION
* **Name:** ________________________________________
* **Position/Office:** ________________________________________
* **Date:** ________________________________________
* **Contact:** ________________________________________

---

### A. Historical Deployment & Traffic Flow Records (Dose-Response Baseline)
1. Does TTMO maintain shift-level records of enforcer counts per location, alongside any traffic flow/congestion reading (TSI, speed, or advisory level) for the same date/time/location?  
   [ ] Yes [ ] No  
   * **Date range available:** _______________________________________________  
   * **Format (logbook, spreadsheet, system export):** _______________________________________________  

*This is the single most valuable dataset for our baseline — even a partial export (e.g., 2–3 months) with naturally varying officer counts is sufficient to fit a dose-response curve.*

---

### B. List of Identified Traffic Bottlenecks
Official list of bottlenecks / high-congestion intersections available?  
[ ] Yes [ ] No  

---

### C. Operational Constraints
* **Standard shift structure(s):** _______________________________________________  
* **Minimum / maximum enforcers per location:** _______________________________________________  

---

### D. Official Performance Standards (External Validation — Part I, §1.6)
Does TTMO use documented targets for deployment effectiveness (response time, coverage, congestion thresholds)?  
[ ] Yes [ ] No  

| Metric / Indicator | Target or Threshold | How Measured |
| :--- | :--- | :--- |
| | | |

---

### E. Permission for On-Site Documentation
Photographs of bottleneck locations / TTMO monitoring area for use as manuscript visuals?  
[ ] Yes [ ] No [ ] With conditions (specify below)  
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

### Prepared by:
* Andalajao, Helmer Lorenz A.
* Amolong, Herald Kent N.
* Ortilano, Justine Kyle T.
* Sua, Aurelio Inocencio III S.
