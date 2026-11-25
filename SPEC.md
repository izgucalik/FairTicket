FAIRTICKET

Solana Tabanlı Şeffaf ve Kontrollü Biletleme Ekosistemi

Hackathon Proje Önerisi • Geliştirilmiş Sürüm

Temel yaklaşım

Bilet sahipliğini doğrulanabilir hâle getirmek, ikincil satışları belirlenen kurallara bağlamak ve etkinlik girişinde tekrar kullanımı önlemek.

1. Proje Özeti

FairTicket, etkinlik biletlerinde görülen sahte bilet, kopyalanmış QR kod, kontrolsüz ikincil satış ve güvensiz bilet devri sorunlarına yönelik Solana tabanlı bir biletleme projesidir. Sistem, biletin dijital sahipliğini zincir üzerinde temsil eder; biletin devredilmesi ve yeniden satılması için kurallar tanımlar; etkinlik girişinde ise kısa ömürlü ve tek kullanımlık doğrulama akışı kullanır.

Projenin hackathon sürümünde amaç, tüm ticari ödeme ve turnike altyapısını üretim seviyesinde tamamlamak değil; temel iddiayı çalışan bir prototiple göstermektir: bilet oluşturma, kurallı ikincil satış ve tek kullanımlık giriş doğrulaması.

2. Problem ve Önerilen Çözüm

Problem

Kullanıcıya etkisi

FairTicket yaklaşımı

Sahte veya kopyalanmış bilet

Aynı bilet birden fazla kişiye satılabilir; kullanıcı etkinliğe alınmayabilir.

Biletin geçerliliği, yetkili program ve bilet kaydı üzerinden kontrol edilir.

Kontrolsüz ikincil satış

Biletler yüksek fiyatlarla yeniden satılabilir; organizatör satıştan pay alamayabilir.

Pazar yeri işlemi, organizatörün belirlediği fiyat ve telif kurallarına göre yürütülür.

Güvensiz bilet devri

Alıcı ve satıcı platform dışı ödeme/devir nedeniyle dolandırıcılık riski yaşar.

Ödeme ve bilet devri tek bir pazar yeri işlemi içinde eşleştirilir.

3. Ürün Akışı ve Sistem Mimarisi

FairTicket beş ana bileşenden oluşur:

Web arayüzü: Etkinlikleri, biletleri ve ikincil pazar yerini gösterir.

Solana cüzdanı: Kullanıcının işlemleri imzalamasını ve bilet sahipliğini yönetmesini sağlar.

Solana programı (Anchor): Bilet oluşturma, listeleme, satış kuralları ve kullanılmış bilet durumunu yönetir.

Doğrulama servisi: Girişte sunulan kısa ömürlü kodu, imzayı ve tek kullanımlık nonce bilgisini kontrol eder.

Turnike/görevli arayüzü: QR kodu tarar, doğrulama sonucunu gösterir ve başarılı girişten sonra bileti kullanılmış olarak işaretler.

3.1 Kullanıcı yolculuğu

Organizatör, etkinliği ve bilet kurallarını sisteme tanımlar.

Kullanıcı cüzdanını bağlar ve Devnet üzerinde test amaçlı bilet edinir.

Biletini devretmek isteyen kullanıcı, bileti FairTicket pazar yerinde listeler.

Alıcı, belirlenen fiyat sınırları içindeki bileti satın alır; ödeme dağıtımı ve bilet devri aynı işlem akışında gerçekleştirilir.

Etkinlik girişinde kullanıcıya ait kısa ömürlü QR kod taranır.

Doğrulama başarılıysa bilet kullanılmış olarak işaretlenir; tekrar okutma reddedilir.

4. Teknik Tasarım ve Güvenlik

4.1 Bilet sahipliği ve yetkili bilet üretimi

Her etkinlik için yetkili organizatör hesabı ve etkinlik kaydı tanımlanır. Biletler yalnızca bu yetkili akış üzerinden oluşturulur. Pazar yeri ve doğrulama servisi, biletin doğru etkinliğe bağlı olduğunu ve yetkili program tarafından üretildiğini kontrol eder.

4.2 İkincil satış, fiyat sınırı ve telif

Önerilen modelde ikincil satış, FairTicket pazar yeri programı üzerinden yapılır. Program; biletin listeleme kaydını, satış fiyatını, organizatörün belirlediği azami fiyat kuralını ve telif oranını kontrol eder. Satış tamamlandığında alıcı ödemesi satıcı ve organizatör arasında tanımlanan oranlara göre dağıtılır ve bilet yeni sahibine aktarılır.

Önemli teknik not: Token-2022 Transfer Hook, transfer sırasında özel program mantığı çalıştırılmasını sağlar; tek başına satış fiyatını, ödeme tutarını veya telifin ödendiğini kanıtlamaz. Bu nedenle fiyat kontrolü ve ödeme dağıtımı pazar yeri programında açıkça uygulanmalı; Hook ise izin verilen transfer yolunu sınırlandıran ek kontrol olarak tasarlanmalıdır. Ücretsiz devir, iade ve organizatör kaynaklı transfer gibi istisnalar da ayrıca tanımlanmalıdır.

4.3 Dinamik QR ve giriş doğrulaması

Giriş ekranı, bilet kimliğiyle birlikte kısa süre geçerli bir doğrulama değeri ve tek kullanımlık nonce içeren QR üretir. Sunucu; bilet sahipliğini, zaman penceresini, imza ve nonce geçerliliğini kontrol eder. Başarılı doğrulama sonrasında nonce tüketilir ve biletin kullanılmış durumu güncellenir. Aynı doğrulama verisinin yeniden kullanılması reddedilir.

Güvenlik sınırı: Dinamik QR ekran görüntüsünün yeniden kullanılma riskini azaltır; tek başına tüm saldırıları ortadan kaldırdığı iddia edilmemelidir. Sunucu güvenliği, turnike cihazlarının yetkilendirilmesi, ağ bağlantısı ve eş zamanlı okutma senaryoları da test edilmelidir.

4.4 Ödeme yaklaşımı

Hackathon prototipinde gerçek para yerine Solana Devnet üzerinde test token'ı veya Devnet USDC kullanılacaktır. Kredi kartı, banka transferi, TL dönüşümü ve gerçek ödeme kuruluşu entegrasyonları canlı ürünün sonraki aşamasına bırakılmıştır.

5. Hackathon MVP Kapsamı

Takımın sınırlı sürede tamamlayabileceği ve jüriye canlı olarak gösterebileceği kapsam üç ana işlevle sınırlandırılmıştır:

MVP özelliği

Demo kabul ölçütü

Bilet oluşturma ve sahiplik

Devnet üzerinde bilet oluşturma, cüzdana tanımlama ve sahipliği arayüzde gösterme.

Kurallı ikincil satış

Bir biletin pazar yerinde listelenmesi; azami fiyat kuralının kontrol edilmesi; test token'ıyla ödeme ve telif dağıtımının gösterilmesi.

Tek kullanımlık giriş doğrulaması

QR üretme/tarama, geçerlilik kontrolü, başarılı girişte kullanıldı durumuna geçme ve ikinci okutmayı reddetme.

5.1 MVP dışında bırakılanlar

Gerçek kredi kartı, banka ve TL–USDC dönüşüm entegrasyonları.

Gerçek stadyum turnikeleri ve yüksek hacimli üretim altyapısı.

Üretim ortamında kapsamlı multisig, kurumsal organizatör paneli ve tüm iade senaryoları.

Bağımsız güvenlik denetimi ve ana ağda gerçek varlıklarla kullanım.

6. Demo Senaryosu ve Sunum Akışı

0:00–0:30 | Problem — Sahte bilet, kopyalanabilir QR ve kontrolsüz yeniden satış sorununu kısa bir örnekle anlatın.

0:30–1:10 | Bilet oluşturma — Organizatör/etkinlik kaydı üzerinden Devnet biletini oluşturun ve cüzdandaki sahipliği gösterin.

1:10–2:00 | İkincil satış — Bileti izin verilen fiyatla listeleyin; sınırı aşan satış denemesinin reddedildiğini, geçerli satışta ödeme/telif dağıtımını gösterin.

2:00–2:40 | Giriş doğrulaması — QR kodu taratın, biletin kullanıldı durumuna geçtiğini ve tekrar okutmanın reddedildiğini gösterin.

2:40–3:00 | Kapanış — Çözümün kullanıcıya, organizatöre ve etkinlik sektörüne sağladığı değeri özetleyin.

7. Jürinin Sorabileceği Sorular

Kullanıcı bileti ücretsiz devredebilir mi?

Bu, ürün kuralı olarak açıkça kararlaştırılmalıdır. Ücretsiz devir desteklenecekse fiyat sınırı ve telif kuralından ayrı, yetkili bir transfer akışı tanımlanmalıdır.

Platform dışı nakit satış tamamen engellenebilir mi?

Zincir dışındaki nakit anlaşmasını mutlak biçimde engellemek mümkün değildir. Sistem, bilet token'ının izinsiz transferini sınırlandırarak ve resmi pazar yerini güvenli seçenek hâline getirerek bu riski azaltır.

İnternet kesilirse turnike çalışır mı?

Hackathon MVP'sinde çevrimiçi doğrulama varsayılır. Çevrimdışı kullanım, tekrar kullanım ve senkronizasyon riskleri nedeniyle ayrı bir sonraki aşama tasarımı gerektirir.

Aynı QR iki turnikede aynı anda okutulursa ne olur?

Nonce tüketimi ve biletin kullanıldı durumuna geçişi tekil/atomik bir işlem olarak tasarlanmalıdır. Demo öncesinde eş zamanlı istek testi yapılmalıdır.

Transfer Hook fiyatı nasıl kontrol eder?

Hook transfer sırasında özel program kontrolü sağlar; fiyat ve ödeme bilgisi pazar yeri işleminde doğrulanmalıdır. Hook tek başına fiyatlandırma veya ödeme garantisi değildir.

Neden Solana?

Düşük işlem maliyeti, hızlı işlem onayı ve Token-2022 gibi token uzantıları, sık ve düşük tutarlı bilet işlemleri için uygun bir altyapı sunar. Performans iddiaları ölçülmüş test sonuçlarıyla desteklenmelidir.

8. Başarı Ölçütleri ve Son Kontrol Listesi

Bilet yalnızca yetkili etkinlik/program akışıyla oluşturulabiliyor.

Bilet sahipliği cüzdan ve program kaydı üzerinden doğrulanabiliyor.

Azami fiyatı aşan listeleme/satış işlemi reddediliyor.

Başarılı ikincil satışta ödeme ve telif dağıtımı beklenen şekilde gerçekleşiyor.

Geçerli QR doğrulaması bileti kullanıldı durumuna geçiriyor.

Aynı QR veya nonce tekrar kullanıldığında işlem reddediliyor.

Demo boyunca kullanılan ağ, token ve test hesapları jüriye açıkça belirtiliyor.

Henüz geliştirilmemiş özellikler canlı özellik gibi sunulmuyor.

9. Sonuç

FairTicket, gerçek bir sektörel probleme odaklanan ve Solana altyapısını işlevsel bir amaçla kullanan bir hackathon fikridir. Projenin gücü, çok sayıda özelliği vaat etmesinden değil; bilet sahipliği, kurallı yeniden satış ve güvenli giriş doğrulamasını çalışan bir uçtan uca demoda kanıtlamasından gelecektir. Bu nedenle takımın önceliği kapsamı büyütmek değil, üç temel akışı güvenilir biçimde tamamlamak olmalıdır.

Not: Bu belge geliştirme ve sunum planıdır; burada anlatılan teknik bileşenlerin tamamının uygulandığı anlamına gelmez. Demo öncesinde her özellik gerçek Devnet işlemleriyle doğrulanmalıdır.
Görevli ekranı: QR tarar, /qr/verify sonucunu gösterir.
Eş zamanlı iki okutmada sadece biri başarılı olmalı. Demo öncesi test edilecek."