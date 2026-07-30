{
  description = "Agent-friendly Linear CLI";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      releaseRevision = self.rev or (throw "linear-axi release build requires an immutable source revision");
      releaseSource = import ./nix/verified-release-source.nix {
        revision = releaseRevision;
        repository = "https://github.com/henrikkvamme/linear-axi.git";
        sourceNarHash = self.narHash or (throw "linear-axi release build requires a source content hash");
      };
      releaseSourcePaths = [
        "src"
        ".agents/skills/linear-axi/COMMANDS.md"
        ".agents/skills/linear-axi/SKILL.md"
        "docs/linear-mcp-parity.json"
        "package.json"
        "package-lock.json"
        "scripts/build.ts"
        "scripts/package-revision.ts"
        "scripts/release-provenance.ts"
      ];
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          linear-axi = pkgs.buildNpmPackage {
            pname = "linear-axi";
            version = "0.2.0";

            src = pkgs.lib.cleanSourceWith {
              name = "linear-axi-source";
              src = releaseSource.outPath;
              filter = path: _type:
                let
                  relative = pkgs.lib.removePrefix "${releaseSource.outPath}/" (toString path);
                in
                pkgs.lib.any (
                  sourcePath:
                  relative == sourcePath
                  || pkgs.lib.hasPrefix "${sourcePath}/" relative
                  || pkgs.lib.hasPrefix "${relative}/" sourcePath
                ) releaseSourcePaths;
            };

            npmDepsFetcherVersion = 2;
            npmDepsHash = "sha256-1+sm6E04GqdhQ8jvwmg5LtfN7sDazMajBok1Gim50VI=";
            nativeBuildInputs = [ pkgs.bun pkgs.git ];
            dontNpmBuild = true;

            buildPhase = ''
              runHook preBuild
              cp ${releaseSource.revisionFile} SOURCE_REVISION
              bun scripts/build.ts --revision ${releaseRevision} --outfile linear-axi
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              install -Dm755 linear-axi "$out/bin/linear-axi"
              runHook postInstall
            '';

            meta = {
              description = "AXI-friendly Linear CLI for agents";
              homepage = "https://github.com/henrikkvamme/linear-axi";
              license = pkgs.lib.licenses.mit;
              mainProgram = "linear-axi";
              platforms = systems;
            };
          };
        in
        {
          inherit linear-axi;
          default = linear-axi;
        }
      );
    };
}
