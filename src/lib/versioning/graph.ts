export interface CommitNode {
  id: string;
  parent_commit_id: string | null;
  merge_parent_commit_id: string | null;
}

function distancesFrom(
  commits: Map<string, CommitNode>,
  startId: string,
): Map<string, number> {
  const distances = new Map<string, number>();
  const queue: Array<{ id: string; distance: number }> = [
    { id: startId, distance: 0 },
  ];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (distances.has(current.id)) continue;
    distances.set(current.id, current.distance);

    const commit = commits.get(current.id);
    if (!commit) continue;
    for (const parentId of [
      commit.parent_commit_id,
      commit.merge_parent_commit_id,
    ]) {
      if (parentId && !distances.has(parentId)) {
        queue.push({ id: parentId, distance: current.distance + 1 });
      }
    }
  }

  return distances;
}

export function findCommonAncestor(
  nodes: CommitNode[],
  oursId: string,
  theirsId: string,
): string | null {
  const commits = new Map(nodes.map((node) => [node.id, node]));
  const oursDistances = distancesFrom(commits, oursId);
  const theirsDistances = distancesFrom(commits, theirsId);

  const candidates = [...oursDistances.entries()]
    .filter(([id]) => theirsDistances.has(id))
    .map(([id, oursDistance]) => ({
      id,
      maxDistance: Math.max(oursDistance, theirsDistances.get(id) ?? Infinity),
      totalDistance: oursDistance + (theirsDistances.get(id) ?? Infinity),
    }))
    .sort(
      (left, right) =>
        left.maxDistance - right.maxDistance ||
        left.totalDistance - right.totalDistance ||
        left.id.localeCompare(right.id),
    );

  return candidates[0]?.id ?? null;
}

