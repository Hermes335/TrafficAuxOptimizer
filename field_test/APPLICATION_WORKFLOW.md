# Application workflow after the September 28 fixes

## Shadow session

1. In Optimization, select the operational date and shift, choose **Shadow field comparison**, and enter a session name.
2. Run the recommendation and use **Export recommendation** on its result or history entry. The export includes run/session IDs, mode, operational date, capture time, timezone, bottleneck IDs, badges, TSI, provenance, and publication state.
3. Record actual officer presence and vehicle counts independently, with an observation timestamp, sampling duration, and explicit units. “Vehicle count” should specify whether motorcycles are included.
4. Keep manual assignments authoritative. Shadow recommendations are blocked by the publication API as well as the frontend.

Existing historical runs without an operational date or input snapshot need a new run before operational publication. Historical publication records are not automatically reconstructed from older audit notes.

## Dated comparison

Choose an explicit recommendation and date. Shadow recommendations can be compared without publication:

```powershell
python manage.py field_test_compare --location "Prime State" --shift afternoon --date 2026-09-25 --run-id RUN_ID --observations-csv ../field_test/shadow_pilot_observations_2026-09-25.csv
```

The selected run must contain a matching date/shift and its input snapshot. Legacy runs can be read for comparison using their input capture date; the command labels this inference, since their intended deployment date was not recorded. Legacy exports label unrecorded publication/decision states as unknown. For a recorded publication, replace `--run-id RUN_ID` with `--revision-id REVISION_ID`. Use `--manual-date YYYY-MM-DD` when selecting a baseline from a different day; the dates are printed explicitly.

Comparison uses saved recommendation/publication data and its TSI, rather than current TSI or all dates combined. Manual counts include only assigned/completed intervals overlapping the selected baseline shift. Cancelled future plans are excluded. Assignment records do not establish actual field presence or prove traffic effects. Raw field TSI and vehicle counts are not converted into normalized application TSI.

## September 25 records requiring reconciliation

The recommendation CSV has five records marked `Published=Yes`, with `Supervisor_Decision=Pending`. Each recommends five officers. The observation CSV records four manual/actual officers at four intervals. Its first note says preparation/confirmation is needed and that motorcycles are included in `Car_count`.

The CSVs remain unchanged. Before using this session as evidence, confirm:

- Whether it was an unpublished shadow session, an app-publication test with unchanged field deployment, or an approved operational intervention.
- The supervisor's actual decision, publication effective times, and actual officer presence.
- Whether the first observation was confirmed and the counting duration and vehicle categories used.

An app publication is separate from physical officer deployment. Five recommended officers and four observed officers must remain separate facts until the session records are reconciled.
