"""Maximum coverage followed by global operational and skill preferences."""
from heapq import heappop, heappush
from math import ceil, floor, isfinite

from core.skills import SKILL_OPTIONS, skill_match, skill_preference_score
from .travel import transfer_seconds_available


def match_officers(engine, officers, nodes, proposed, previous=None, start=None, wif=1):
    """Fill the proposed posts without adding demand or changing eligibility.

    Among maximum-cardinality matches, minimize (in order): disrupted continuity,
    whole-minute travel, missing skill preference points, exact travel, and changes
    to the GA proposal. A higher tier dominates the sum of every lower tier.
    """
    previous = previous or {}
    by_node = {node["id"]: node for node in nodes}
    officers = sorted(officers, key=lambda officer: officer["id"])
    slots = sorted(row["bottleneck_id"] for row in proposed)
    preferred_pairs = {(row["officer_id"], row["bottleneck_id"]) for row in proposed}
    edges = []
    for officer_idx, officer in enumerate(officers):
        prior = previous.get(officer["id"])
        origin = officer if not prior else {**officer, "current_latitude": prior["latitude"], "current_longitude": prior["longitude"]}
        pair_costs = {}
        for slot_idx, node_id in enumerate(slots):
            if node_id not in pair_costs:
                node = by_node[node_id]
                minutes = engine._distance_km(origin, node) / max(8, 28*(1-float(node.get("tsi", 0)))) * 60 * wif
                continuing = bool(prior and prior["node_id"] == node_id)
                feasible = isfinite(minutes) and (not prior or continuing or
                    transfer_seconds_available(officer, prior["end"], start) >= ceil(minutes*60))
                preferences = node.get("preferred_skills", [])
                skill_penalty = len(SKILL_OPTIONS)-skill_preference_score(officer.get("skills", []), preferences)
                pair_costs[node_id] = ((int(not continuing), floor(minutes+0.5), skill_penalty,
                    round(minutes*1000), int((officer["id"], node_id) not in preferred_pairs), officer_idx) if feasible else None)
            tiers = pair_costs[node_id]
            if tiers is None:
                continue
            edges.append((officer_idx, slot_idx, tiers))
    if not edges:
        return []
    flow_limit = min(len(officers), len(slots))
    bounds = [max(edge[2][i] for edge in edges)*flow_limit for i in range(len(edges[0][2]))]
    scales, scale = [], 1
    for bound in reversed(bounds):
        scales.append(scale)
        scale *= bound+1
    scales.reverse()
    source, sink = len(officers)+len(slots), len(officers)+len(slots)+1
    graph = [[] for _ in range(sink+1)]

    def add_edge(left, right, cost):
        forward = [right, len(graph[right]), 1, cost]
        backward = [left, len(graph[left]), 0, -cost]
        graph[left].append(forward)
        graph[right].append(backward)
        return forward

    for i in range(len(officers)):
        add_edge(source, i, 0)
    for i in range(len(slots)):
        add_edge(len(officers)+i, sink, 0)
    choices = [(i, j, add_edge(i, len(officers)+j, sum(t*s for t, s in zip(tiers, scales)))) for i, j, tiers in edges]
    potentials = [0]*len(graph)
    for _ in range(flow_limit):
        distances, parents = [None]*len(graph), [None]*len(graph)
        distances[source] = 0
        heap = [(0, source)]
        while heap:
            distance, left = heappop(heap)
            if distance != distances[left]:
                continue
            for idx, (right, _reverse, capacity, cost) in enumerate(graph[left]):
                if not capacity:
                    continue
                candidate = distance+cost+potentials[left]-potentials[right]
                if distances[right] is None or candidate < distances[right]:
                    distances[right], parents[right] = candidate, (left, idx)
                    heappush(heap, (candidate, right))
        if distances[sink] is None:
            break
        for i, distance in enumerate(distances):
            if distance is not None:
                potentials[i] += distance
        right = sink
        while right != source:
            left, idx = parents[right]
            edge = graph[left][idx]
            edge[2] = 0
            graph[right][edge[1]][2] = 1
            right = left
    result = []
    for officer_idx, slot_idx, edge in choices:
        if edge[2]:
            continue
        officer, node_id = officers[officer_idx], slots[slot_idx]
        node = by_node[node_id]
        result.append({"officer_id": officer["id"], "badge_number": officer.get("badge_number"),
                       "bottleneck_id": node_id, "bottleneck_name": node.get("name"),
                       "skill_match": skill_match(officer.get("skills", []), node.get("preferred_skills", []))})
    return sorted(result, key=lambda row: (row["officer_id"], row["bottleneck_id"]))
