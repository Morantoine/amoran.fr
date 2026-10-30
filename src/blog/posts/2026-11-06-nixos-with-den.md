---
title: Organising my NixOS config with den
description: How I use den to organise my NixOS config by feature instead of by machine.
---

In my [last post](/blog/why-nixos/) I explained why I use NixOS on my laptop and my servers. This
one is about how the config itself is organised. It's managed with
[den](https://github.com/denful/den), and I think it's a really nice way to structure a NixOS
config once you have more than one machine.

## The problem

A common way to organise a NixOS config is one folder per machine, each with its own
`configuration.nix` that imports shared modules. That works, but it gets messy when one feature
needs to touch several parts of the system.

For example, when I add a web service to my server, I need:

- the service itself, often a container;
- a route in Traefik, my reverse proxy, sometimes restricted to my VPN or behind single sign-on;
- sometimes a firewall rule;
- an uptime check in Gatus, my monitoring tool;
- a tile on my Homepage dashboard;
- the folders it needs to keep across reboots, because my machines erase their root filesystem on
  boot.

With a config organised by machine, these things end up in different files, and when you remove the
service you have to remember to clean up all of them. With den, everything about the service is in
one place.

## Aspects

den is based on the "dendritic" pattern. Every `.nix` file in my `modules/` folder is a
[flake-parts](https://flake.parts/) module, and [import-tree](https://github.com/denful/import-tree)
loads all of them automatically, so I never have to maintain a list of imports. Files whose name
starts with `_`, like `_hardware.nix`, are skipped.

On top of that, den adds **aspects**. An aspect is a named piece of configuration. It can contain
NixOS options, Home Manager options, and a list of other aspects to include. Machines and users are
declared separately, and a machine is basically the list of aspects it uses. This is gila, my
monitoring server, a bit shortened:

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

My main server has the same kind of list, just longer (59 entries). To see what runs on a machine,
I only need to read that list.

## Reusable aspects

Aspects can also be functions that take arguments. den calls these "batteries", and you can write
your own under `den.provides`, then use them as `den._.<name>`.

The one I use the most is called `proxied-service`. You give it a subdomain and a port, plus a few
options, and it creates the Traefik route, the VPN restriction if needed, the single sign-on with
Kanidm if needed, the Gatus check and the Homepage entry. With it, my whole Vaultwarden config looks
like this:

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

41 of my aspects use `proxied-service`. I also have one for containers, `media-container`, which
sets the usual user and timezone variables, the shared Podman network and the secrets file. If I
want to change how all my services are exposed, I only change one file.

## Aspects that send data to each other

You might have noticed that the Vaultwarden aspect never mentions Gatus or Homepage, but it still
appears in both. This works with what den calls **quirks**. A quirk is like a named list that any
aspect can add to, and that another aspect can read. I declare mine once:

```nix
den.quirks.gatus-endpoint.description = "Gatus monitoring endpoint contributions from service aspects.";
den.quirks.homepage-entry.description = "Homepage dashboard entry contributions from service aspects.";
den.quirks.firewall-port.description  = "Firewall port contributions from service aspects.";
```

A service adds an entry (here through `proxied-service`):

```nix
gatus-endpoint = {
  name = "Vaultwarden";
  url = "http://127.0.0.1:8222";
  conditions = ["[STATUS] == 200"];
  alerts = [{type = "ntfy";}];
};
```

and the Gatus aspect receives every entry from the machine as an argument:

```nix
den.aspects.gatus.nixos = {gatus-endpoint, ...}: {
  services.gatus.settings.endpoints = gatus-endpoint;
};
```

The firewall works the same way. My WireGuard aspect adds `firewall-port.udp = [5553];`, and the
server opens all the ports its aspects asked for:

```nix
allowedUDPPorts = lib.concatMap (p: p.udp or []) firewall-port;
```

So my dashboard, my monitoring and my open ports always match what is actually installed. When I
remove a service from the list, its tile, its check and its port go away with it.

### Between machines

With den's **policies**, this also works across machines. Each machine declares its own WireGuard
peer in its own file:

```nix
den.aspects.gila.wireguard-peer = {
  publicKey = "…";
  allowedIPs = ["192.168.100.4/32"];
};
```

and the WireGuard server collects the peers of all my machines:

```nix
den.policies.fleet-wireguard-peers = _: [
  (den.lib.policy.pipe.from "wireguard-peer" [
    (den.lib.policy.pipe.collect ({host, ...}: host != null))
  ])
];
```

To add a new machine to the VPN, I declare its key in its own config, and I don't need to edit the
server's list of peers.

## Impermanence

As I said in the last post, my machines erase their root filesystem on every boot, so every folder
that needs to be kept has to be declared. With den, each aspect declares its own folders. For
Firefox:

```nix
den.aspects.firefox.includes = [
  (den._.persist {home.directories = [".mozilla"];})
];
```

The `impermanence` aspect then collects everything and passes it to the impermanence module. If I
remove Firefox, `.mozilla` isn't kept anymore.

## NixOS and Home Manager together

In a plain NixOS config, system settings and Home Manager settings live in two separate module
systems. If one feature needs both, you write two modules and import them in two different places:
one in the machine's config, the other in `home-manager.users.<name>`.

The dendritic pattern on its own already lets you put both in the same file, as
`flake.modules.nixos.foo` and `flake.modules.homeManager.foo`, but you still have to import each
one in the right place yourself.

With den, an aspect can have a `nixos` part and a `homeManager` part, and including the aspect once
is enough: den applies the NixOS part to the machine and the Home Manager part to its users. My
impermanence aspect does both:

```nix
den.aspects.impermanence = {
  nixos = {persist, lib, ...}: {
    environment.persistence."/persist".directories =
      lib.concatMap (p: p.nixos.directories or []) persist;
  };

  homeManager = {persist, lib, ...}: {
    home.persistence."/persist".directories =
      lib.concatMap (p: p.home.directories or []) persist;
  };
};
```

## Machines and users

den makes a difference between a machine, a user, and a user on a specific machine. On my laptop,
the desktop is configured for my user on that machine, under `_.antoine`:

```nix
den.aspects.balrog._.antoine.includes = [
  den.aspects.niri
  den.aspects.dms
  den.aspects.firefox
  den.aspects.theme
];
```

An aspect can also ask which user it's being applied to. My Git config takes my name and email from
my user declaration instead of writing them again:

```nix
den.aspects.git = {user, ...}: {
  homeManager.programs.git.settings.user = {
    name = user.userName;
    email = user.email;
  };
};
```

## Flake inputs

The last tool I use is [flake-file](https://github.com/denful/flake-file). Instead of writing all
the inputs in `flake.nix`, each module declares the inputs it needs, and `flake.nix` is generated
with `nix run .#write-flake`. For example, my impermanence aspect starts with:

```nix
flake-file.inputs.impermanence.url = "github:nix-community/impermanence";
```

If I delete the aspect, the input goes away too.

## The downsides

There's more to learn than with a classic config: aspects, batteries, quirks and policies come on
top of the NixOS module system, and when something goes wrong the errors can be hard to follow.

den also looks at the names of a function's arguments (`host`, `user`…) to decide where to apply
it. So replacing `{host, ...}` with `_` changes what the code does, even though linters like
deadnix suggest doing exactly that when the argument isn't used.

Finally, den is still young and changes quite a lot.

## In summary

For a single machine, a normal config is probably enough. But with a server running many services
and several machines that share things, den makes it much easier to add or remove something
without forgetting a piece somewhere. If you want to see a complete example, the author of den
shares his own config, [vix](https://tangled.org/oeiuwq.com/vix).

Thanks for reading!
