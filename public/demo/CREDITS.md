# Demo photos

Photos for the two demo salons (Maple & Ash and Harbor & Vine): booking page covers, menu category photos, stylist portraits and photos of their work. Seeded by `supabase/seed.sql` and `supabase/seed-large.sql` as paths from the site's root (`/demo/...`), served as the app's static files, and never stored in or deleted from Storage (`isBundledPhoto` and `removeStored` in `lib/branding.ts`).

Every photo is from Unsplash under the [Unsplash License](https://unsplash.com/license): free to use, including commercially, without permission or attribution, though credit is given here. Unsplash's license doesn't allow selling a photo unaltered or using one to build a competing photo service. People shown are Unsplash models, not the salons' staff; the stylists and salons are fictional. Chosen with no salon signs, logos or product brands in frame and no widely recognizable people.

Portraits are cropped to one 4:5 head-and-shoulders frame with their brightness evened out, so they read as one salon's team. Other photos are cropped from the original at Unsplash's image service.

Product thumbnails in the app are drawn shapes (`components/product-thumb.tsx`), not photos.

| File | Shows | Photographer | Unsplash photo | License |
| --- | --- | --- | --- | --- |
| `covers/maple-and-ash.jpg` | Maple & Ash cover | Giorgio Trovato | https://unsplash.com/photos/XBcURNhKeog | Unsplash License |
| `covers/harbor-and-vine.jpg` | Harbor & Vine cover | Giorgio Trovato | https://unsplash.com/photos/qrz6s4yDcIM | Unsplash License |
| `categories/cuts.jpg` | Cuts category: Cutting wet hair with scissors | Farhad Ibrahimzade | https://unsplash.com/photos/V2HDOQTJh3o | Unsplash License |
| `categories/blowouts-and-styling.jpg` | Blowouts & Styling category: Blow-dry with a round brush | Adam Winger | https://unsplash.com/photos/FkAZqQJTbXM | Unsplash License |
| `categories/color.jpg` | Color category: Color being applied | Ionela Mat | https://unsplash.com/photos/qMjrFNDdjpw | Unsplash License |
| `categories/highlights.jpg` | Highlights category: Foils | Lera Kogan | https://unsplash.com/photos/B1B-53ZBgng | Unsplash License |
| `categories/balayage.jpg` | Balayage category: Soft blonde balayage | Lera Kogan | https://unsplash.com/photos/CIrRI0ujiRo | Unsplash License |
| `categories/treatments.jpg` | Treatments category: At the basin | Lindsay Cash | https://unsplash.com/photos/Md_DhaFsnCQ | Unsplash License |
| `categories/nails.jpg` | Nails category: Pale pink manicure | Chelson Tamares | https://unsplash.com/photos/vtQHwU4F13s | Unsplash License |
| `categories/skin.jpg` | Skin category: Facial mask | Rosa Rafael | https://unsplash.com/photos/Pe9IXUuC6QU | Unsplash License |
| `categories/brows-and-lashes.jpg` | Brows & Lashes category: Brow shaping | nastiia nikitenko | https://unsplash.com/photos/U88HKDGynE4 | Unsplash License |
| `team/bridget.jpg` | Bridget Callahan (portrait) | Giorgio Trovato | https://unsplash.com/photos/VzusBjHlKM8 | Unsplash License |
| `team/gil.jpg` | Gil Navarro (portrait) | Willian Souza | https://unsplash.com/photos/p5BoBF0XJUA | Unsplash License |
| `team/hannah.jpg` | Hannah Novak (portrait) | Clay Elliot | https://unsplash.com/photos/mpDV4xaFP8c | Unsplash License |
| `team/nola.jpg` | Nola Brennan (portrait) | Carlos Gil | https://unsplash.com/photos/S4CXgCbs9BE | Unsplash License |
| `team/sandra.jpg` | Sandra Whitfield (portrait) | alex starnes | https://unsplash.com/photos/WYE2UhXsU1Y | Unsplash License |
| `team/shae.jpg` | Shae Morgan (portrait) | Ryan Hoffman | https://unsplash.com/photos/Ft4p5E9HjTQ | Unsplash License |
| `team/lois.jpg` | Lois Park (portrait) | Joecalih | https://unsplash.com/photos/8Cbk_IGBoQU | Unsplash License |
| `work/bridget-1.jpg` | Bridget's work: Silver-brown balayage | Lera Kogan | https://unsplash.com/photos/KBoUUqE97r8 | Unsplash License |
| `work/bridget-2.jpg` | Bridget's work: Warm brown | Taylor Smith | https://unsplash.com/photos/zz-UAKRabJs | Unsplash License |
| `work/gil-1.jpg` | Gil's work: Sleek bob from behind | Lu | https://unsplash.com/photos/TcWwRcf92GY | Unsplash License |
| `work/hannah-1.jpg` | Hannah's work: Loose waves | Todd Trapani | https://unsplash.com/photos/7pCUY-UoIQ0 | Unsplash License |
| `work/sandra-1.jpg` | Sandra's work: Vivid blue | Luis Quintero | https://unsplash.com/photos/gTOfWL7prYA | Unsplash License |
| `work/sandra-2.jpg` | Sandra's work: Lilac | Lera Kogan | https://unsplash.com/photos/PD2RYMtsGhc | Unsplash License |
| `work/sandra-3.jpg` | Sandra's work: Rainbow color | Jessie Dee Dabrowski | https://unsplash.com/photos/TETR8YLSqt4 | Unsplash License |
| `work/lois-1.jpg` | Lois's work: Smooth blonde | Alexander Grey | https://unsplash.com/photos/ORCPTrkkezw | Unsplash License |
