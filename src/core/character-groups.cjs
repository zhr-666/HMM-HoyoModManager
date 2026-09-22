// GameBanana's category IDs identify the hierarchy, independent of translated labels.
function characterGroups(taxonomy, charactersCategoryId = '18140') {
  const groups = new Map();
  function visit(nodes, inCharacters = false, character = null) {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      const id = String(node.id);
      const group = inCharacters ? character || id : null;
      groups.set(id, group);
      visit(node.children, inCharacters || id === String(charactersCategoryId), group);
    }
  }
  visit(taxonomy);
  return groups;
}

module.exports = {characterGroups};
