var path = require('path');

var p = new Promise(function(resolve, reject) {
	resolve("f worked");
});

p.then(function(s) 
{
	s = s + " and then did this";
	return s;
})
.catch(function(reason) {
	console.log('catch 1');
	console.log(reason);
})
.then(function(s) 
{
	s = s + ' and finally this';
	console.log(s);
})
.catch(function(reason) {
	console.log('catch 2');
	console.log(reason);
});

setTimeout(() => {console.log('\r\n\r\n----> done');}, 7);