{
  revision,
  repository,
  sourceNarHash,
  rootedSource ? null,
}:
let
  exactRevision = builtins.match "[0-9a-fA-F]{40}" revision != null;
  committedSource =
    if rootedSource != null then
      {
        outPath = rootedSource;
        narHash = sourceNarHash;
      }
    else
      builtins.fetchTree {
        type = "git";
        url = repository;
        rev = revision;
      };
  revisionFile = builtins.toFile "linear-axi-SOURCE_REVISION" "${revision}\n";
in
if !exactRevision then
  throw "linear-axi Nix release build requires an exact 40-hex immutable source revision"
else if sourceNarHash != committedSource.narHash then
  throw "linear-axi Nix release source differs from its immutable Git revision"
else
  committedSource // { inherit revisionFile; }
