import csv
with open('C:/Users/Vlad/Desktop/carfactory/InventoryMaster.csv', 'r') as f:
    reader = csv.DictReader(f)
    count = 0
    real = 0
    for row in reader:
        if row.get('status','').strip() == 'INSTOCK':
            count += 1
            make = row.get('make','').strip()
            stockno = row.get('stockno','').strip()
            if make and stockno:
                real += 1
                if real <= 5:
                    year = row.get('year','').strip()
                    model = row.get('model','').strip()
                    color = row.get('colorexterior','').strip()
                    lot = row.get('lotno','').strip()
                    vin = row.get('vin','').strip()
                    print(f"Stock:{stockno} Year:{year} Make:{make} Model:{model} Color:{color} Lot:{lot} VIN:{vin[:10]}")
    print(f"Total INSTOCK: {count} | With make+stockno: {real}")
