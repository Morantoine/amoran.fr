---
title: One file per feature, my NixOS fleet with den
description: How den's aspects let me describe three machines and fifty-odd services by feature instead of by host.
---

My NixOS config runs three machines: **balrog**, my laptop; **cyboogie**, a home server with
around fifty self-hosted services; and **gila**, a small box whose job is to watch cyboogie.
Since moving the whole thing to [den](https://github.com/denful/den), adding a service to the
server is usually one file of twenty lines, and the reverse proxy, firewall, uptime monitoring,
dashboard and backups of state all follow from it.

This post is about why that works.

<!-- TODO(Antoine): one or two sentences on what the config looked like before den and what annoyed you. -->

## The problem with organising by host

The usual NixOS layout is one directory per machine, each with a `configuration.nix` that
imports shared modules. That works until a single feature has to touch several parts of the
system. Take a web service on my server. To run it properly I need:

- the service itself, often a container;
- a Traefik router, maybe behind the VPN or behind single sign-on;
- a firewall rule, if it listens on a public port;
- an uptime check in Gatus;
- a tile on my Homepage dashboard;
- its state declared as persistent, because the root filesystem is wiped on every boot.

In a host-centric config those six things live in six different files, and removing the service
means remembering all six. In den they live in one place, next to each other.

## Aspects and hosts

den builds on the *dendritic* pattern: every `.nix` file under `modules/` is a flake-parts
module, and [import-tree](https://github.com/denful/import-tree) loads them all. There is no
import list to maintain. Files starting with `_`, like `_hardware.nix`, are skipped.

On top of that, den gives you **aspects**: named bundles of configuration that can carry NixOS
options, Home Manager options and a list of other aspects they include. Hosts and users are
declared as data. A host then becomes little more than the list of features it has. Here is
gila, trimmed:

```nix
den.hosts.x86_64-linux.gila.users.antoine = {};

den.aspects.gila.includes = [
  den.aspects.shell
  den.aspects.common
  den.aspects.nix
  den.aspects.sops
  den.aspects.traefik
  den.aspects.gatus-public
  den.aspects.ntfy
  den.aspects.beszel-agent
];
```

cyboogie's list is longer (59 entries) but reads the same way. If I want to know what runs on
a machine, I read one list.

## Parametric aspects: writing the boring part once

Aspects can be functions. den calls them "batteries" when they are meant to be reused, and you
can write your own under `den.provides`, then use them as `den._.<name>`.

Mine is called `proxied-service`. It takes a subdomain and a port, plus a few options, and
produces the Traefik router and backend, an optional VPN-only gate, an optional Kanidm OIDC gate
(with a bypass route for VPN clients), a Gatus endpoint and a Homepage entry. My whole
Vaultwarden aspect is this:

```nix
den.aspects.vaultwarden = {
  includes = [
    (den._.proxied-service {
      subdomain = "bit";
      port = 8222;
      vpnOnly = true;
      monitorName = "Vaultwarden";
      homepage.group = "Small Icons";
    })
  ];

  nixos = {config, ...}: {
    sops.secrets.vaultwarden_token = { /* … */ };
    services.vaultwarden = {
      enable = true;
      environmentFile = config.sops.secrets.vaultwarden_token.path;
      config.ROCKET_PORT = 8222;
    };
  };
};
```

41 of my aspects go through `proxied-service`. Containers use a second battery,
`media-container`, which fills in the PUID/PGID/timezone defaults, the shared Podman network and
the sops environment file. When I changed how OIDC is wired into Traefik, I changed one file.

## Aspects that talk to each other

Look at the Vaultwarden example again: it never mentions Gatus or Homepage, yet it shows up in
both. That works through what den calls **quirks**: named channels that any aspect can write to
and another aspect can read as a module argument. I declare them once:

```nix
den.quirks.gatus-endpoint.description = "Gatus monitoring endpoint contributions from service aspects.";
den.quirks.homepage-entry.description = "Homepage dashboard entry contributions from service aspects.";
den.quirks.firewall-port.description  = "Firewall port contributions from service aspects.";
```

A service writes to them (here, through `proxied-service`):

```nix
gatus-endpoint = {
  name = "Vaultwarden";
  url = "http://127.0.0.1:8222";
  conditions = ["[STATUS] == 200"];
  alerts = [{type = "ntfy";}];
};
```

and the Gatus aspect collects everything that was written, from every aspect on that host:

```nix
den.aspects.gatus.nixos = {gatus-endpoint, ...}: {
  services.gatus.settings.endpoints = gatus-endpoint;
};
```

The firewall works the same way. The WireGuard aspect says `firewall-port.udp = [5553];`, and
the host opens whatever its aspects asked for:

```nix
allowedUDPPorts = lib.concatMap (p: p.udp or []) firewall-port;
```

So the dashboard, the monitoring and the open ports are always exactly what is installed. When I
drop a service from cyboogie's list, its tile, its uptime check and its port go with it.

### Across machines

Quirks can also cross host boundaries, using den's **policies**. Each machine declares its own
WireGuard peer in its own host file:

```nix
den.aspects.gila.wireguard-peer = {
  publicKey = "…";
  allowedIPs = ["192.168.100.4/32"];
};
```

and the WireGuard server aspect uses a policy to collect the peers of every host in the fleet:

```nix
den.policies.fleet-wireguard-peers = _: [
  (den.lib.policy.pipe.from "wireguard-peer" [
    (den.lib.policy.pipe.collect ({host, ...}: host != null))
  ])
];
```

A new machine joins the VPN by declaring its key next to the rest of its config. The server's
peer list is never edited by hand.

## Impermanence without a giant list

All my machines wipe their root filesystem on boot, so every path that should survive has to be
declared. In most configs I've seen, that becomes one long list in the host file that slowly
drifts away from reality.

With den, each aspect declares what it needs. Firefox, for example:

```nix
den.aspects.firefox.includes = [
  (den._.persist {home.directories = [".mozilla"];})
];
```

The `impermanence` aspect is a pure collector: it reads the `persist` quirk and turns it into
`environment.persistence` and `home.persistence`. A policy in `den.nix` broadcasts the
Home Manager part to every user on the host. Remove Firefox, and `.mozilla` stops being
persisted.

## Hosts and users

den knows the difference between "this host", "this user" and "this user on this host". On my
laptop, the desktop belongs to me rather than to the machine, so it goes under `_.antoine`:

```nix
den.aspects.balrog._.antoine.includes = [
  den.aspects.niri
  den.aspects.dms
  den.aspects.firefox
  den.aspects.theme
];
```

and an aspect can ask for the user it is being applied to. My Git config reads my name and
e-mail from the user declaration instead of hard-coding them:

```nix
den.aspects.git = {user, ...}: {
  homeManager.programs.git.settings.user = {
    name = user.userName;
    email = user.email;
  };
};
```

## Inputs live next to the code that uses them

The last piece is [flake-file](https://github.com/denful/flake-file). Instead of one big
`inputs` block, each module declares the inputs it needs, and `flake.nix` is generated from them
with `nix run .#write-flake`. The impermanence aspect starts with:

```nix
flake-file.inputs.impermanence.url = "github:nix-community/impermanence";
```

so deleting an aspect also deletes its input.

## What it costs

It isn't free.

- **More to learn.** Aspects, batteries, quirks and policies are four new ideas on top of the
  module system, and errors come back through several layers of functions.
- **Argument names matter.** den looks at which arguments a function asks for (`host`, `user`)
  to decide where to apply it. Replacing `{host, ...}` with `_` silently changes the meaning,
  and linters like deadnix will happily suggest exactly that. My config has comments warning
  my future self about it.
- **It moves.** den is young and its API is still changing. Policies and pipes are recent, and
  I've had to follow along.

For a single laptop, I'm not sure I'd bother. For a fleet where one service touches the proxy,
firewall, monitoring, dashboard, persistence and VPN, it is the first setup where adding or
removing something doesn't leave pieces behind.

## Links

- [den](https://github.com/denful/den), and vic's example config [vix](https://tangled.org/oeiuwq.com/vix)
- [import-tree](https://github.com/denful/import-tree) and [flake-file](https://github.com/denful/flake-file)
- [flake-parts](https://flake.parts/)
