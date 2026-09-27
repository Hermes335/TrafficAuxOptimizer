def required_staffing(node, incidents=()):
    required = max(1, node.min_officers_required)
    if node.tsi >= 0.8:
        required = node.max_officers_allowed
    elif node.tsi >= 0.5:
        required += 1
    if any(i.severity == "critical" for i in incidents):
        required += 1
    return max(1, min(node.max_officers_allowed, required))

def shift_staffing(deployments, required, start, end):
    """Average staffed posts and covered posts across the entire shift."""
    events = [(start, 0), (end, 0)]
    for row in deployments:
        if row.start_time < end and row.end_time > start:
            events.extend([(max(start, row.start_time), 1), (min(end, row.end_time), -1)])
    count = 0
    assigned_seconds = covered_seconds = 0
    previous = start
    for moment, delta in sorted(events):
        duration = (moment - previous).total_seconds()
        assigned_seconds += count * duration
        covered_seconds += min(required, count) * duration
        count += delta
        previous = moment
    duration = (end - start).total_seconds()
    return assigned_seconds / duration, covered_seconds / duration
