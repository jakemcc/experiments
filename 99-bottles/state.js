export function applyAction(maxClicked, index, total) {
  if (index === maxClicked + 1 && maxClicked < total) {
    return maxClicked + 1;
  }

  if (index === maxClicked && maxClicked > 0) {
    return maxClicked - 1;
  }

  return maxClicked;
}
