var https = require('https');
var mysql = require('mysql');
var crypto = require('crypto');
var propertiesReader = require('properties-reader');
var dns = require('dns');


exports.handler = function (event, context) {

    var currentDate = new Date();
    var priorDayDate = new Date();
    priorDayDate.setDate(currentDate.getDate() - 1);

    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";


    // Start and end dates for call to Jenkins to pull build data
    var ddmmyyyy_current_date;
    var ddmmyyyy_priorDay_date;
    // Correct date format to insert records into the database
    var yyyymmdd_date;

    var properties = propertiesReader(__dirname + '/credentials.ini');

    console.log(dns.getServers());

    //for(; tempDate < currentDate; tempDate.setDate(tempDate.getDate() + 1)) {

    if (priorDayDate.getDay() === 0 || priorDayDate.getDay() == 6) {
      console.log("Skipping metrics collection since it's a weekend.");
      process.exit(0);
    }

    ddmmyyyy_current_date = currentDate.getDate() + '-' + (currentDate.getMonth() + 1) + '-' + currentDate.getFullYear();
    ddmmyyyy_priorDay_date = priorDayDate.getDate()  + '-' + (priorDayDate.getMonth() + 1) + '-' + priorDayDate.getFullYear();
    console.log("The dates being passed to Jenkins are: " + ddmmyyyy_current_date + " and " + ddmmyyyy_priorDay_date);
    yyyymmdd_date = priorDayDate.getFullYear() + '-' + (priorDayDate.getMonth() + 1) + '-' + priorDayDate.getDate();

    getRequestData(insertRecords);


    // Function that will get metrics data via HTTPS
    function getRequestData(callback) {

      var id = decrypt(properties.get('ciserver.username'));
      var passwd = decrypt(properties.get('ciserver.pass'));
      var cihost = properties.get('ciserver.host');
      var response;


      var optionsget = {
          host : cihost, // domain name
          port : 443,
          path : '/jenkins/plugin/build-metrics-rest-plugin/api/json/info?depth=3&start='+ddmmyyyy_priorDay_date+'&end='+ddmmyyyy_current_date, // the rest of the url with parameters if needed
          method : 'GET',
          headers: {
            'Authorization': 'Basic ' + new Buffer(id + ':' + passwd).toString('base64')
         }
      };

      console.log('Options prepared:');
      console.log(optionsget);
      console.log('Do the GET call' + '\n');

      // do the GET request

        var reqGet = https.request(optionsget, function(res) {
            console.log("statusCode: ", res.statusCode);

            //uncomment it for header details
            //console.log("headers: ", res.headers);

            var body = "";

            res.on('data', function(d) {
              body += d;
            });
            res.on('end', function() {
              response = JSON.parse(body);
              callback(response);
              });
        });
        reqGet.end();
        reqGet.on('error', function(e) {
            console.error(e);
        });

    }


    // Utility method to decrypt enrypted values
    function decrypt(text) {

      var algorithm = properties.get('encryption.algorithm');
      var password = properties.get('encryption.pass');

      var decipher = crypto.createDecipher(algorithm,password)
      var dec = decipher.update(text,'hex','utf8')
      dec += decipher.final('utf8');

      return dec;
    }

    // Now that we have the metrics from Jenkins, let's insert them into our MySQL instance
    function insertRecords(response) {

      var dbpassword = decrypt(properties.get('datastore.pass'));
      var dbuser = decrypt(properties.get('datastore.username'));
      var dshost = properties.get('datastore.connectionString');
      var dbconnectionport = properties.get('datastore.connectionport');
      var dbname = properties.get('datastore.database');


      var builds = response.total;

      var percentage = (response.success / response.total) * 100;

      var duration = response.duration;
      var currentDate = new Date();
      var createdDate = currentDate.getFullYear() + '-' + (currentDate.getMonth() + 1) + '-' + currentDate.getDate();

      var client = mysql.createConnection({
      host: dshost,
      user: dbuser,
      password: dbpassword,
      port: dbconnectionport,
      database: dbname
      });

      client.connect();

      var sql = 'INSERT INTO metrics_rollup (num_of_builds, build_success_percentage,build_duration,collection_date,created_date,created_by)';
      sql += ' VALUES ('+ builds + "," + percentage + "," + duration + "," + "'" + yyyymmdd_date + "'," + "'" + createdDate + "'," + "'awsuser'" + ")";

      console.info(sql);

      client.query(sql, function(err, res) {
        if (err){
          console.log(err);
        }

      });

      client.end();

    }
};
