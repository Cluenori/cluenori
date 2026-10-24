{
  description = "Cluenori development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      supportedSystems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];

      forEachSystem = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
      devShells = forEachSystem (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          # No C compiler: every dependency ships built, and it is a third of the shell's download.
          default = pkgs.mkShellNoCC {
            packages = [
              # Installs packages and runs the repository's programs. Never the deployed runtime:
              # production runs in workerd.
              pkgs.bun
              pkgs.git

              # Wrangler and Vitest run on Node; Wrangler requires Node 22 or later.
              pkgs.nodejs_24
            ];

            # Wrangler asks before sending usage data; nobody should be asked in a dev shell.
            WRANGLER_SEND_METRICS = "false";
          };
        }
      );

      formatter = forEachSystem (system: nixpkgs.legacyPackages.${system}.nixfmt);
    };
}
