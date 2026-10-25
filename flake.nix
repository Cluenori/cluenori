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
          node = pkgs.nodejs_latest;
        in
        {
          # Only what the repository's commands run, as the shell is every orb's download. No C
          # compiler: every dependency ships built, and it was a third of it.
          default = pkgs.mkShellNoCC {
            packages = [
              # Installs packages and runs the repository's programs. Never the deployed runtime:
              # production runs in workerd. Git is the machine's own: every machine that has the
              # repository has one, and Nix's would add a third to the shell, for Perl and its
              # modules.
              pkgs.bun

              # Wrangler and Vitest run on Node (Wrangler requires 22 or later): its newest release.
              node
            ];

            # Wrangler asks before sending usage data; nobody should be asked in a dev shell.
            WRANGLER_SEND_METRICS = "false";
          };
        }
      );

      formatter = forEachSystem (system: nixpkgs.legacyPackages.${system}.nixfmt);
    };
}
