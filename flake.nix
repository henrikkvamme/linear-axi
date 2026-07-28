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
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          linear-axi = pkgs.buildNpmPackage {
            pname = "linear-axi";
            version = "0.2.0";

            src = pkgs.lib.fileset.toSource {
              root = ./.;
              fileset = pkgs.lib.fileset.unions [
                ./src
                ./docs/linear-mcp-parity.json
                ./package.json
                ./package-lock.json
                ./scripts/build.ts
              ];
            };

            npmDepsFetcherVersion = 2;
            npmDepsHash = "sha256-Toc+DUUK4UcO10j/HSmQ1pqIS2ADVO21A+nztHUVAaY=";
            nativeBuildInputs = [ pkgs.bun ];
            dontNpmBuild = true;

            buildPhase = ''
              runHook preBuild
              bun scripts/build.ts --revision ${self.rev or (throw "linear-axi release build requires an immutable source revision")} --outfile linear-axi
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
